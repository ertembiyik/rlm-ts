/**
 * LocalSandbox – executes Python code via child_process in a temporary directory.
 *
 * Mirrors rlm/environments/local_repl.py 1:1.
 *
 * Communication with the LM handler is done via HTTP (the handler exposes
 * /llm_query and /llm_query_batched endpoints).
 *
 * The Python script is self-contained: it serialises state with JSON,
 * provides llm_query / llm_query_batched / FINAL_VAR / SHOW_VARS helpers,
 * and returns structured JSON on stdout.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { REPLResult, RLMChatCompletion, Message } from "../core/types.js";
import type { Sandbox, SupportsPersistence } from "./base.js";

export interface LocalSandboxOptions {
  lmHandlerAddress?: { host: string; port: number } | null;
  contextPayload?: string | Record<string, unknown> | unknown[] | null;
  setupCode?: string | null;
  persistent?: boolean;
  depth?: number;
}

export class LocalSandbox implements Sandbox, SupportsPersistence {
  private lmHandlerAddress: { host: string; port: number } | null;
  private tempDir: string;
  private depth: number;
  private contextCount = 0;
  private historyCount = 0;
  private statePath: string;

  constructor(options: LocalSandboxOptions = {}) {
    this.lmHandlerAddress = options.lmHandlerAddress ?? null;
    this.depth = options.depth ?? 1;
    this.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rlm_sandbox_"));
    this.statePath = path.join(this.tempDir, "state.json");

    // Initialise empty state file
    fs.writeFileSync(this.statePath, JSON.stringify({}), "utf-8");

    this.setup();

    if (options.contextPayload != null) {
      this.loadContext(options.contextPayload);
    }
    if (options.setupCode) {
      this.executeCode(options.setupCode);
    }
  }

  setup(): void {
    // Nothing extra – state file is already created in constructor.
  }

  loadContext(contextPayload: string | Record<string, unknown> | unknown[]): void {
    this.addContext(contextPayload, 0);
  }

  addContext(
    contextPayload: string | Record<string, unknown> | unknown[],
    contextIndex?: number
  ): number {
    const idx = contextIndex ?? this.contextCount;
    const varName = `context_${idx}`;

    if (typeof contextPayload === "string") {
      const contextPath = path.join(this.tempDir, `context_${idx}.txt`);
      fs.writeFileSync(contextPath, contextPayload, "utf-8");
      this.executeCode(
        `with open(r'${contextPath}', 'r') as f:\n    ${varName} = f.read()`
      );
    } else {
      const contextPath = path.join(this.tempDir, `context_${idx}.json`);
      fs.writeFileSync(contextPath, JSON.stringify(contextPayload), "utf-8");
      this.executeCode(
        `import json\nwith open(r'${contextPath}', 'r') as f:\n    ${varName} = json.load(f)`
      );
    }

    // Alias context_0 as 'context'
    if (idx === 0) {
      this.executeCode(`context = ${varName}`);
    }

    this.contextCount = Math.max(this.contextCount, idx + 1);
    return idx;
  }

  getContextCount(): number {
    return this.contextCount;
  }

  updateHandlerAddress(address: { host: string; port: number }): void {
    this.lmHandlerAddress = address;
  }

  addHistory(messageHistory: Message[], historyIndex?: number): number {
    const idx = historyIndex ?? this.historyCount;
    const varName = `history_${idx}`;

    // Write history to a JSON file and load it via code execution
    const historyPath = path.join(this.tempDir, `history_${idx}.json`);
    fs.writeFileSync(historyPath, JSON.stringify(messageHistory), "utf-8");
    this.executeCode(
      `import json\nwith open(r'${historyPath}', 'r') as f:\n    ${varName} = json.load(f)`
    );

    // Alias history_0 as 'history'
    if (idx === 0) {
      this.executeCode(`history = ${varName}`);
    }

    this.historyCount = Math.max(this.historyCount, idx + 1);
    return idx;
  }

  getHistoryCount(): number {
    return this.historyCount;
  }

  executeCode(code: string): REPLResult {
    const start = performance.now();

    const proxyUrl = this.lmHandlerAddress
      ? `http://${this.lmHandlerAddress.host}:${this.lmHandlerAddress.port}`
      : "";

    // Build self-contained Python execution script
    const script = buildExecScript(code, this.statePath, proxyUrl, this.depth);
    const scriptPath = path.join(this.tempDir, "exec.py");
    fs.writeFileSync(scriptPath, script, "utf-8");

    let stdout = "";
    let stderr = "";
    try {
      stdout = execSync(`python3 "${scriptPath}"`, {
        cwd: this.tempDir,
        timeout: 300_000,
        maxBuffer: 50 * 1024 * 1024,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string };
      stdout = execErr.stdout ?? "";
      stderr = execErr.stderr ?? "";
    }

    // Parse structured JSON from the last line of stdout
    const lines = stdout.trimEnd().split("\n");
    const lastLine = lines[lines.length - 1] ?? "";
    let rlmCalls: RLMChatCompletion[] = [];

    try {
      const data = JSON.parse(lastLine) as {
        stdout?: string;
        stderr?: string;
        locals?: Record<string, unknown>;
        rlm_calls?: Array<{
          root_model: string;
          prompt: string;
          response: string;
          usage_summary: {
            model_usage_summaries: Record<
              string,
              { total_calls: number; total_input_tokens: number; total_output_tokens: number }
            >;
          };
          execution_time: number;
        }>;
      };

      // Parse rlm_calls if present
      if (data.rlm_calls) {
        rlmCalls = data.rlm_calls.map((call) => ({
          rootModel: call.root_model,
          prompt: call.prompt,
          response: call.response,
          usageSummary: {
            modelUsageSummaries: Object.fromEntries(
              Object.entries(call.usage_summary?.model_usage_summaries ?? {}).map(
                ([model, usage]) => [
                  model,
                  {
                    totalCalls: usage.total_calls,
                    totalInputTokens: usage.total_input_tokens,
                    totalOutputTokens: usage.total_output_tokens,
                  },
                ]
              )
            ),
          },
          executionTime: call.execution_time,
        }));
      }

      return {
        stdout: data.stdout ?? "",
        stderr: (data.stderr ?? "") + stderr,
        locals: data.locals ?? {},
        executionTime: (performance.now() - start) / 1000,
        rlmCalls,
      };
    } catch {
      return {
        stdout,
        stderr: stderr || "Parse error",
        locals: {},
        executionTime: (performance.now() - start) / 1000,
        rlmCalls,
      };
    }
  }

  cleanup(): void {
    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

// ─── Python execution script builder ───────────────────────────────────────

function buildExecScript(
  code: string,
  statePath: string,
  proxyUrl: string,
  depth: number
): string {
  // Base64-encode the code to avoid quoting issues
  const codeB64 = Buffer.from(code, "utf-8").toString("base64");

  return `
import sys, io, json, base64, traceback, os, time

try:
    import urllib.request
    import urllib.error
    HAS_URLLIB = True
except ImportError:
    HAS_URLLIB = False

STATE = ${JSON.stringify(statePath)}
PROXY = ${JSON.stringify(proxyUrl)}
DEPTH = ${depth}

_rlm_calls = []

def llm_query(prompt, model=None):
    if not PROXY:
        return "Error: No LM handler configured"
    try:
        data = json.dumps({"prompt": prompt, "model": model, "depth": DEPTH}).encode()
        req = urllib.request.Request(
            f"{PROXY}/llm_query",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        start = time.time()
        with urllib.request.urlopen(req, timeout=300) as resp:
            d = json.loads(resp.read().decode())
        elapsed = time.time() - start
        if "error" in d and d["error"]:
            return f"Error: {d['error']}"
        if "rlm_call" in d and d["rlm_call"]:
            _rlm_calls.append(d["rlm_call"])
        return d.get("response", "")
    except Exception as e:
        return f"Error: {e}"

def llm_query_batched(prompts, model=None):
    if not PROXY:
        return ["Error: No LM handler configured"] * len(prompts)
    try:
        data = json.dumps({"prompts": prompts, "model": model, "depth": DEPTH}).encode()
        req = urllib.request.Request(
            f"{PROXY}/llm_query_batched",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            d = json.loads(resp.read().decode())
        if "error" in d and d["error"]:
            return [f"Error: {d['error']}"] * len(prompts)
        if "rlm_calls" in d and d["rlm_calls"]:
            _rlm_calls.extend(d["rlm_calls"])
        return d.get("responses", [f"Error: no response"] * len(prompts))
    except Exception as e:
        return [f"Error: {e}"] * len(prompts)

def load_state():
    if os.path.exists(STATE):
        try:
            with open(STATE, "r") as f:
                return json.load(f)
        except:
            pass
    return {}

def save_state(s):
    clean = {}
    for k, v in s.items():
        if k.startswith("_"):
            continue
        try:
            json.dumps(v)
            clean[k] = v
        except (TypeError, ValueError):
            clean[k] = repr(v)
    with open(STATE, "w") as f:
        json.dump(clean, f)

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

_safe_builtins = {
    "print": print, "len": len, "str": str, "int": int, "float": float,
    "list": list, "dict": dict, "set": set, "tuple": tuple, "bool": bool,
    "type": type, "isinstance": isinstance, "issubclass": issubclass,
    "enumerate": enumerate, "zip": zip, "map": map, "filter": filter,
    "sorted": sorted, "reversed": reversed, "range": range,
    "min": min, "max": max, "sum": sum, "abs": abs, "round": round,
    "any": any, "all": all, "pow": pow, "divmod": divmod,
    "chr": chr, "ord": ord, "hex": hex, "bin": bin, "oct": oct,
    "repr": repr, "ascii": ascii, "format": format, "hash": hash, "id": id,
    "iter": iter, "next": next, "slice": slice, "callable": callable,
    "hasattr": hasattr, "getattr": getattr, "setattr": setattr, "delattr": delattr,
    "dir": dir, "vars": vars, "bytes": bytes, "bytearray": bytearray,
    "memoryview": memoryview, "complex": complex, "object": object,
    "super": super, "property": property, "staticmethod": staticmethod,
    "classmethod": classmethod, "__import__": __import__, "open": open,
    "Exception": Exception, "BaseException": BaseException,
    "ValueError": ValueError, "TypeError": TypeError,
    "KeyError": KeyError, "IndexError": IndexError,
    "AttributeError": AttributeError, "FileNotFoundError": FileNotFoundError,
    "OSError": OSError, "IOError": IOError, "RuntimeError": RuntimeError,
    "NameError": NameError, "ImportError": ImportError,
    "StopIteration": StopIteration, "AssertionError": AssertionError,
    "NotImplementedError": NotImplementedError, "ArithmeticError": ArithmeticError,
    "LookupError": LookupError, "Warning": Warning,
    "input": None, "eval": None, "exec": None, "compile": None,
    "globals": None, "locals": None,
}

_globals = {
    "__builtins__": _safe_builtins,
    "__name__": "__main__",
    "llm_query": llm_query,
    "llm_query_batched": llm_query_batched,
    "FINAL_VAR": FINAL_VAR,
    "SHOW_VARS": SHOW_VARS,
}

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

_safe_locals = {}
for k, v in _locals.items():
    if not k.startswith("_"):
        try:
            json.dumps(v)
            _safe_locals[k] = v
        except (TypeError, ValueError):
            _safe_locals[k] = repr(v)

print(json.dumps({
    "stdout": stdout_buf.getvalue(),
    "stderr": stderr_buf.getvalue(),
    "locals": _safe_locals,
    "rlm_calls": _rlm_calls,
}, ensure_ascii=False))
`;
}
