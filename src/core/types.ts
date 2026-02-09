/**
 * Core types for RLM - Recursive Language Models.
 *
 * Mirrors the Python rlm.core.types module 1:1.
 */

import type { LanguageModelV1 } from "ai";

// ─── Provider / Sandbox type literals ───────────────────────────────────────

/**
 * Sandbox backends that can execute REPL code.
 * "local"  – in-process Python via child_process (non-isolated)
 * "docker" – Python inside a Docker container (semi-isolated)
 *
 * Additional backends (e.g. Apple Virtualization Framework, Vercel Sandboxes)
 * can be added by implementing the Sandbox interface.
 */
export type SandboxType = "local" | "docker";

// ─── Serialisation helper ───────────────────────────────────────────────────

export function serializeValue(value: unknown): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "function") {
    return `<function '${value.name || "anonymous"}'>`;
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[String(k)] = serializeValue(v);
    }
    return result;
  }
  try {
    return String(value);
  } catch {
    return `<${typeof value}>`;
  }
}

// ─── LM Cost Tracking ──────────────────────────────────────────────────────

export interface ModelUsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export function modelUsageSummaryToDict(s: ModelUsageSummary): Record<string, number> {
  return {
    total_calls: s.totalCalls,
    total_input_tokens: s.totalInputTokens,
    total_output_tokens: s.totalOutputTokens,
  };
}

export function modelUsageSummaryFromDict(d: Record<string, number>): ModelUsageSummary {
  return {
    totalCalls: d.total_calls ?? 0,
    totalInputTokens: d.total_input_tokens ?? 0,
    totalOutputTokens: d.total_output_tokens ?? 0,
  };
}

export interface UsageSummary {
  modelUsageSummaries: Record<string, ModelUsageSummary>;
}

export function usageSummaryToDict(s: UsageSummary): Record<string, unknown> {
  const summaries: Record<string, Record<string, number>> = {};
  for (const [model, usage] of Object.entries(s.modelUsageSummaries)) {
    summaries[model] = modelUsageSummaryToDict(usage);
  }
  return { model_usage_summaries: summaries };
}

export function usageSummaryFromDict(d: Record<string, unknown>): UsageSummary {
  const raw = (d.model_usage_summaries ?? {}) as Record<string, Record<string, number>>;
  const summaries: Record<string, ModelUsageSummary> = {};
  for (const [model, usage] of Object.entries(raw)) {
    summaries[model] = modelUsageSummaryFromDict(usage);
  }
  return { modelUsageSummaries: summaries };
}

// ─── REPL & RLM Iteration types ────────────────────────────────────────────

export interface RLMChatCompletion {
  rootModel: string;
  prompt: string | Record<string, unknown> | Message[];
  response: string;
  usageSummary: UsageSummary;
  executionTime: number;
}

export function rlmChatCompletionToDict(c: RLMChatCompletion): Record<string, unknown> {
  return {
    root_model: c.rootModel,
    prompt: c.prompt,
    response: c.response,
    usage_summary: usageSummaryToDict(c.usageSummary),
    execution_time: c.executionTime,
  };
}

export function rlmChatCompletionFromDict(d: Record<string, unknown>): RLMChatCompletion {
  return {
    rootModel: d.root_model as string,
    prompt: d.prompt as string | Record<string, unknown>,
    response: d.response as string,
    usageSummary: usageSummaryFromDict(d.usage_summary as Record<string, unknown>),
    executionTime: d.execution_time as number,
  };
}

export interface REPLResult {
  stdout: string;
  stderr: string;
  locals: Record<string, unknown>;
  executionTime: number;
  rlmCalls: RLMChatCompletion[];
}

export function replResultToDict(r: REPLResult): Record<string, unknown> {
  return {
    stdout: r.stdout,
    stderr: r.stderr,
    locals: Object.fromEntries(
      Object.entries(r.locals).map(([k, v]) => [k, serializeValue(v)])
    ),
    execution_time: r.executionTime,
    rlm_calls: r.rlmCalls.map(rlmChatCompletionToDict),
  };
}

export interface CodeBlock {
  code: string;
  result: REPLResult;
}

export function codeBlockToDict(b: CodeBlock): Record<string, unknown> {
  return { code: b.code, result: replResultToDict(b.result) };
}

export interface RLMIteration {
  prompt: string | Record<string, unknown> | Message[];
  response: string;
  codeBlocks: CodeBlock[];
  finalAnswer?: string | null;
  iterationTime?: number | null;
}

export function rlmIterationToDict(it: RLMIteration): Record<string, unknown> {
  return {
    prompt: it.prompt,
    response: it.response,
    code_blocks: it.codeBlocks.map(codeBlockToDict),
    final_answer: it.finalAnswer ?? null,
    iteration_time: it.iterationTime ?? null,
  };
}

// ─── RLM Metadata ──────────────────────────────────────────────────────────

export interface RLMMetadata {
  rootModel: string;
  maxDepth: number;
  maxIterations: number;
  sandboxType: string;
  sandboxKwargs: Record<string, unknown>;
  otherModels?: string[] | null;
}

export function rlmMetadataToDict(m: RLMMetadata): Record<string, unknown> {
  return {
    root_model: m.rootModel,
    max_depth: m.maxDepth,
    max_iterations: m.maxIterations,
    sandbox_type: m.sandboxType,
    sandbox_kwargs: Object.fromEntries(
      Object.entries(m.sandboxKwargs).map(([k, v]) => [k, serializeValue(v)])
    ),
    other_models: m.otherModels ?? null,
  };
}

// ─── Query Metadata ────────────────────────────────────────────────────────

export interface QueryMetadata {
  contextLengths: number[];
  contextTotalLength: number;
  contextType: string;
}

export function buildQueryMetadata(
  prompt: string | Record<string, unknown> | unknown[]
): QueryMetadata {
  if (typeof prompt === "string") {
    return {
      contextLengths: [prompt.length],
      contextTotalLength: prompt.length,
      contextType: "string",
    };
  }

  if (Array.isArray(prompt)) {
    if (prompt.length === 0) {
      return { contextLengths: [0], contextTotalLength: 0, contextType: "list" };
    }
    const first = prompt[0];
    if (typeof first === "object" && first !== null && "content" in first) {
      const lengths = prompt.map((item) =>
        String((item as Record<string, unknown>).content ?? "").length
      );
      return {
        contextLengths: lengths,
        contextTotalLength: lengths.reduce((a, b) => a + b, 0),
        contextType: "list",
      };
    }
    const lengths = prompt.map((item) => {
      if (typeof item === "string") return item.length;
      try {
        return JSON.stringify(item).length;
      } catch {
        return String(item).length;
      }
    });
    return {
      contextLengths: lengths,
      contextTotalLength: lengths.reduce((a, b) => a + b, 0),
      contextType: "list",
    };
  }

  if (typeof prompt === "object" && prompt !== null) {
    const lengths: number[] = [];
    for (const value of Object.values(prompt)) {
      if (typeof value === "string") {
        lengths.push(value.length);
      } else {
        try {
          lengths.push(JSON.stringify(value).length);
        } catch {
          lengths.push(String(value).length);
        }
      }
    }
    return {
      contextLengths: lengths,
      contextTotalLength: lengths.reduce((a, b) => a + b, 0),
      contextType: "dict",
    };
  }

  throw new Error(`Invalid prompt type: ${typeof prompt}`);
}

// ─── Message type ──────────────────────────────────────────────────────────

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

// ─── RLM configuration ────────────────────────────────────────────────────

export interface RLMConfig {
  /** AI SDK LanguageModelV1 instance – the primary/root model. */
  model: LanguageModelV1;

  /** Sandbox type to use for code execution. */
  sandbox?: SandboxType;

  /** Extra kwargs forwarded to the sandbox constructor. */
  sandboxKwargs?: Record<string, unknown>;

  /** Current recursion depth (0 = root). */
  depth?: number;

  /** Maximum recursion depth. Currently only depth 1 is supported. */
  maxDepth?: number;

  /** Maximum REPL iterations before forcing a final answer. */
  maxIterations?: number;

  /** Custom system prompt to replace the default RLM prompt. */
  customSystemPrompt?: string;

  /**
   * Optional AI SDK model for sub-calls (depth=1).
   * Used when REPL code calls llm_query().
   */
  subModel?: LanguageModelV1;

  /** RLMLogger instance for writing iteration logs. */
  logger?: import("../logger/index.js").RLMLogger;

  /** Enable rich console output. */
  verbose?: boolean;

  /** Reuse sandbox across completion() calls for multi-turn conversations. */
  persistent?: boolean;
}
