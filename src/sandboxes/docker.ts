/**
 * DockerSandbox – executes Python code inside a Docker container.
 *
 * Mirrors rlm/environments/docker_repl.py 1:1.
 *
 * Communication with the LM handler is done via an HTTP proxy server
 * that runs on the host and is accessible from the container via
 * host.docker.internal.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { REPLResult, RLMChatCompletion, Message } from "../core/types.js";
import type { Sandbox } from "./base.js";

export interface DockerSandboxOptions {
  image?: string;
  lmHandlerAddress?: { host: string; port: number } | null;
  contextPayload?: string | Record<string, unknown> | unknown[] | null;
  setupCode?: string | null;
  depth?: number;
}

export class DockerSandbox implements Sandbox {
  private image: string;
  private lmHandlerAddress: { host: string; port: number } | null;
  private containerId: string | null = null;
  private proxyServer: http.Server | null = null;
  private proxyPort = 0;
  private tempDir: string;
  private depth: number;
  private pendingCalls: RLMChatCompletion[] = [];

  constructor(options: DockerSandboxOptions = {}) {
    this.image = options.image ?? "python:3.11-slim";
    this.lmHandlerAddress = options.lmHandlerAddress ?? null;
    this.depth = options.depth ?? 1;

    const baseDir = process.env.RLM_DOCKER_WORKSPACE_DIR ?? path.join(process.cwd(), ".rlm_workspace");
    fs.mkdirSync(baseDir, { recursive: true });
    this.tempDir = fs.mkdtempSync(path.join(baseDir, "docker_repl_"));
  }

  async setup(): Promise<void> {
    // Start HTTP proxy server
    await this.startProxy();

    // Start Docker container
    const result = execSync(
      [
        "docker", "run", "-d", "--rm",
        "-v", `${this.tempDir}:/workspace`,
        "--add-host", "host.docker.internal:host-gateway",
        this.image,
        "tail", "-f", "/dev/null",
      ].join(" "),
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();

    this.containerId = result;

    // Install dependencies
    execSync(
      `docker exec ${this.containerId} pip install -q dill requests`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
  }

  private async startProxy(): Promise<void> {
    return new Promise((resolve) => {
      this.proxyServer = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          this.handleProxyRequest(req.url ?? "", body)
            .then((result) => {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));
            })
            .catch((err: Error) => {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err.message }));
            });
        });
      });

      this.proxyServer.listen(0, "127.0.0.1", () => {
        const addr = this.proxyServer!.address() as { port: number };
        this.proxyPort = addr.port;
        resolve();
      });
    });
  }

  private async handleProxyRequest(
    url: string,
    body: string
  ): Promise<Record<string, unknown>> {
    if (!this.lmHandlerAddress) {
      return { error: "No LM handler configured" };
    }

    const parsed = JSON.parse(body) as Record<string, unknown>;

    // Forward to the LM handler HTTP server
    const handlerUrl = `http://${this.lmHandlerAddress.host}:${this.lmHandlerAddress.port}${url}`;

    return new Promise((resolve, reject) => {
      const reqData = JSON.stringify(parsed);
      const reqUrl = new URL(handlerUrl);
      const req = http.request(
        {
          hostname: reqUrl.hostname,
          port: reqUrl.port,
          path: reqUrl.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(reqData),
          },
          timeout: 300_000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
          res.on("end", () => {
            try {
              resolve(JSON.parse(data) as Record<string, unknown>);
            } catch {
              resolve({ error: "Failed to parse handler response" });
            }
          });
        }
      );
      req.on("error", (err: Error) => reject(err));
      req.write(reqData);
      req.end();
    });
  }

  loadContext(contextPayload: string | Record<string, unknown> | unknown[]): void {
    if (typeof contextPayload === "string") {
      const contextPath = path.join(this.tempDir, "context.txt");
      fs.writeFileSync(contextPath, contextPayload, "utf-8");
      this.executeCode(
        "with open('/workspace/context.txt', 'r') as f:\n    context = f.read()"
      );
    } else {
      const contextPath = path.join(this.tempDir, "context.json");
      fs.writeFileSync(contextPath, JSON.stringify(contextPayload), "utf-8");
      this.executeCode(
        "import json\nwith open('/workspace/context.json', 'r') as f:\n    context = json.load(f)"
      );
    }
  }

  executeCode(code: string): REPLResult {
    if (!this.containerId) {
      return {
        stdout: "",
        stderr: "Error: Docker container not started. Call setup() first.",
        locals: {},
        executionTime: 0,
        rlmCalls: [],
      };
    }

    const start = performance.now();
    this.pendingCalls = [];

    const script = buildDockerExecScript(code, this.proxyPort, this.depth);
    const scriptPath = path.join(this.tempDir, "exec.py");
    fs.writeFileSync(scriptPath, script, "utf-8");

    let stdout = "";
    let stderr = "";
    try {
      stdout = execSync(
        `docker exec ${this.containerId} python3 /workspace/exec.py`,
        {
          encoding: "utf-8",
          timeout: 300_000,
          maxBuffer: 50 * 1024 * 1024,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string };
      stdout = execErr.stdout ?? "";
      stderr = execErr.stderr ?? "";
    }

    const lines = stdout.trimEnd().split("\n");
    const lastLine = lines[lines.length - 1] ?? "";

    try {
      const data = JSON.parse(lastLine) as {
        stdout?: string;
        stderr?: string;
        locals?: Record<string, unknown>;
      };
      return {
        stdout: data.stdout ?? "",
        stderr: (data.stderr ?? "") + stderr,
        locals: data.locals ?? {},
        executionTime: (performance.now() - start) / 1000,
        rlmCalls: this.pendingCalls,
      };
    } catch {
      return {
        stdout,
        stderr: stderr || "Parse error",
        locals: {},
        executionTime: (performance.now() - start) / 1000,
        rlmCalls: this.pendingCalls,
      };
    }
  }

  cleanup(): void {
    if (this.containerId) {
      try {
        execSync(`docker stop ${this.containerId}`, { stdio: "pipe" });
      } catch {
        // ignore
      }
      this.containerId = null;
    }
    if (this.proxyServer) {
      this.proxyServer.close();
      this.proxyServer = null;
    }
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

// ─── Docker Python execution script ────────────────────────────────────────

function buildDockerExecScript(code: string, proxyPort: number, depth: number): string {
  const codeB64 = Buffer.from(code, "utf-8").toString("base64");

  return `
import sys, io, json, base64, traceback, os, requests
try:
    import dill
except ImportError:
    import pickle as dill

PROXY = "http://host.docker.internal:${proxyPort}"
STATE = "/workspace/state.dill"

def llm_query(prompt, model=None):
    try:
        r = requests.post(f"{PROXY}/llm_query", json={"prompt": prompt, "model": model, "depth": ${depth}}, timeout=300)
        d = r.json()
        return d.get("response") or f"Error: {d.get('error')}"
    except Exception as e:
        return f"Error: {e}"

def llm_query_batched(prompts, model=None):
    try:
        r = requests.post(f"{PROXY}/llm_query_batched", json={"prompts": prompts, "model": model, "depth": ${depth}}, timeout=300)
        d = r.json()
        return d.get("responses") or [f"Error: {d.get('error')}"] * len(prompts)
    except Exception as e:
        return [f"Error: {e}"] * len(prompts)

def load_state():
    if os.path.exists(STATE):
        try:
            with open(STATE, "rb") as f:
                return dill.load(f)
        except:
            pass
    return {}

def save_state(s):
    clean = {k: v for k, v in s.items() if not k.startswith("_")}
    for k in list(clean.keys()):
        try:
            dill.dumps(clean[k])
        except:
            del clean[k]
    with open(STATE, "wb") as f:
        dill.dump(clean, f)

_locals = load_state()

def FINAL_VAR(name):
    name = name.strip().strip("\\"\\'")
    if name in _locals:
        return str(_locals[name])
    available = [k for k in _locals.keys() if not k.startswith("_")]
    if available:
        return f"Error: Variable '{name}' not found. Available variables: {available}. You must create and assign a variable BEFORE calling FINAL_VAR on it."
    return f"Error: Variable '{name}' not found. No variables have been created yet. You must create and assign a variable in a REPL block BEFORE calling FINAL_VAR on it."

def SHOW_VARS():
    available = {k: type(v).__name__ for k, v in _locals.items() if not k.startswith("_")}
    if not available:
        return "No variables created yet. Use \`\`\`repl\`\`\` blocks to create variables."
    return f"Available variables: {available}"

_globals = {"__builtins__": __builtins__, "__name__": "__main__", "llm_query": llm_query, "llm_query_batched": llm_query_batched, "FINAL_VAR": FINAL_VAR, "SHOW_VARS": SHOW_VARS}

code = base64.b64decode("${codeB64}").decode()
stdout_buf, stderr_buf = io.StringIO(), io.StringIO()
old_stdout, old_stderr = sys.stdout, sys.stderr

try:
    sys.stdout, sys.stderr = stdout_buf, stderr_buf
    combined = {**_globals, **_locals}
    exec(code, combined, combined)
    for k, v in combined.items():
        if k not in _globals and not k.startswith("_"):
            _locals[k] = v
except:
    traceback.print_exc(file=stderr_buf)
finally:
    sys.stdout, sys.stderr = old_stdout, old_stderr

save_state(_locals)
print(json.dumps({"stdout": stdout_buf.getvalue(), "stderr": stderr_buf.getvalue(), "locals": {k: repr(v) for k, v in _locals.items() if not k.startswith("_")}}, ensure_ascii=False))
`;
}
