/**
 * LMHandler – routes LLM requests from the RLM main process and sandbox subprocesses.
 *
 * Mirrors rlm/core/lm_handler.py 1:1.
 *
 * Uses an HTTP server instead of raw TCP sockets for better portability
 * across sandbox backends (Docker, VMs, etc.).
 *
 * Endpoints:
 *   POST /llm_query          – single prompt completion
 *   POST /llm_query_batched  – concurrent batched completions
 */

import http from "node:http";
import { generateText, type LanguageModelV1 } from "ai";
import type {
  RLMChatCompletion,
  UsageSummary,
  ModelUsageSummary,
} from "./types.js";

// ─── Usage tracker ─────────────────────────────────────────────────────────

class UsageTracker {
  private callCounts = new Map<string, number>();
  private inputTokens = new Map<string, number>();
  private outputTokens = new Map<string, number>();
  private lastInputTokens = 0;
  private lastOutputTokens = 0;

  track(model: string, input: number, output: number): void {
    this.callCounts.set(model, (this.callCounts.get(model) ?? 0) + 1);
    this.inputTokens.set(model, (this.inputTokens.get(model) ?? 0) + input);
    this.outputTokens.set(model, (this.outputTokens.get(model) ?? 0) + output);
    this.lastInputTokens = input;
    this.lastOutputTokens = output;
  }

  getUsageSummary(): UsageSummary {
    const summaries: Record<string, ModelUsageSummary> = {};
    for (const model of this.callCounts.keys()) {
      summaries[model] = {
        totalCalls: this.callCounts.get(model) ?? 0,
        totalInputTokens: this.inputTokens.get(model) ?? 0,
        totalOutputTokens: this.outputTokens.get(model) ?? 0,
      };
    }
    return { modelUsageSummaries: summaries };
  }

  getLastUsage(): ModelUsageSummary {
    return {
      totalCalls: 1,
      totalInputTokens: this.lastInputTokens,
      totalOutputTokens: this.lastOutputTokens,
    };
  }
}

// ─── Message type ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── LMHandler ─────────────────────────────────────────────────────────────

export class LMHandler {
  private defaultModel: LanguageModelV1;
  private subModel: LanguageModelV1 | null;
  private models = new Map<string, LanguageModelV1>();
  private tracker = new UsageTracker();
  private server: http.Server | null = null;
  readonly host: string;
  private _port: number;

  constructor(
    defaultModel: LanguageModelV1,
    options: {
      host?: string;
      port?: number;
      subModel?: LanguageModelV1 | null;
    } = {}
  ) {
    this.defaultModel = defaultModel;
    this.subModel = options.subModel ?? null;
    this.host = options.host ?? "127.0.0.1";
    this._port = options.port ?? 0;

    this.registerModel(defaultModel.modelId, defaultModel);
  }

  get port(): number {
    if (this.server) {
      const addr = this.server.address();
      if (addr && typeof addr === "object") {
        return addr.port;
      }
    }
    return this._port;
  }

  get address(): { host: string; port: number } {
    return { host: this.host, port: this.port };
  }

  registerModel(name: string, model: LanguageModelV1): void {
    this.models.set(name, model);
  }

  getModel(modelName?: string | null, depth = 0): LanguageModelV1 {
    if (modelName && this.models.has(modelName)) {
      return this.models.get(modelName)!;
    }
    if (depth === 1 && this.subModel) {
      return this.subModel;
    }
    return this.defaultModel;
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) return this.address;

    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          this.handleRequest(req.url ?? "", body)
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

      this.server.listen(this._port, this.host, () => {
        resolve(this.address);
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private async handleRequest(
    url: string,
    body: string
  ): Promise<Record<string, unknown>> {
    try {
      const data = JSON.parse(body) as Record<string, unknown>;

      if (url === "/llm_query") {
        return this.handleSingle(data);
      } else if (url === "/llm_query_batched") {
        return this.handleBatched(data);
      }

      return { error: `Unknown endpoint: ${url}` };
    } catch (err) {
      return { error: `Request failed: ${err}` };
    }
  }

  private async handleSingle(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const prompt = data.prompt as string | ChatMessage[];
    const modelName = data.model as string | undefined;
    const depth = (data.depth as number) ?? 0;

    const model = this.getModel(modelName, depth);
    const start = performance.now();

    const messages = this.normalisePrompt(prompt);
    const result = await generateText({
      model,
      messages,
    });

    const elapsed = (performance.now() - start) / 1000;
    const inputTokens = result.usage?.promptTokens ?? 0;
    const outputTokens = result.usage?.completionTokens ?? 0;
    const modelId = modelName ?? model.modelId;

    this.tracker.track(modelId, inputTokens, outputTokens);

    const rlmCall: Record<string, unknown> = {
      root_model: modelId,
      prompt: prompt,
      response: result.text,
      usage_summary: {
        model_usage_summaries: {
          [modelId]: {
            total_calls: 1,
            total_input_tokens: inputTokens,
            total_output_tokens: outputTokens,
          },
        },
      },
      execution_time: elapsed,
    };

    return { response: result.text, rlm_call: rlmCall };
  }

  private async handleBatched(
    data: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const prompts = data.prompts as (string | ChatMessage[])[];
    const modelName = data.model as string | undefined;
    const depth = (data.depth as number) ?? 0;

    const model = this.getModel(modelName, depth);
    const start = performance.now();

    const results = await Promise.all(
      prompts.map(async (prompt) => {
        const messages = this.normalisePrompt(prompt);
        return generateText({ model, messages });
      })
    );

    const elapsed = (performance.now() - start) / 1000;
    const modelId = modelName ?? model.modelId;

    const responses: string[] = [];
    const rlmCalls: Record<string, unknown>[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const inputTokens = r.usage?.promptTokens ?? 0;
      const outputTokens = r.usage?.completionTokens ?? 0;

      this.tracker.track(modelId, inputTokens, outputTokens);
      responses.push(r.text);

      rlmCalls.push({
        root_model: modelId,
        prompt: prompts[i],
        response: r.text,
        usage_summary: {
          model_usage_summaries: {
            [modelId]: {
              total_calls: 1,
              total_input_tokens: inputTokens,
              total_output_tokens: outputTokens,
            },
          },
        },
        execution_time: elapsed / results.length,
      });
    }

    return { responses, rlm_calls: rlmCalls };
  }

  private normalisePrompt(
    prompt: string | ChatMessage[] | Record<string, unknown>
  ): ChatMessage[] {
    if (typeof prompt === "string") {
      return [{ role: "user", content: prompt }];
    }
    if (Array.isArray(prompt)) {
      return prompt as ChatMessage[];
    }
    // Single message object
    return [{ role: "user", content: JSON.stringify(prompt) }];
  }

  /**
   * Direct completion call (for main RLM process, not sandbox).
   */
  async completion(
    prompt: string | ChatMessage[] | Record<string, unknown>,
    modelName?: string
  ): Promise<string> {
    const model = this.getModel(modelName);
    const messages = this.normalisePrompt(prompt);
    const result = await generateText({ model, messages });

    const inputTokens = result.usage?.promptTokens ?? 0;
    const outputTokens = result.usage?.completionTokens ?? 0;
    const modelId = modelName ?? model.modelId;
    this.tracker.track(modelId, inputTokens, outputTokens);

    return result.text;
  }

  getUsageSummary(): UsageSummary {
    return this.tracker.getUsageSummary();
  }

  getLastUsage(): ModelUsageSummary {
    return this.tracker.getLastUsage();
  }
}
