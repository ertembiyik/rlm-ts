/**
 * RLM – Recursive Language Models (TypeScript)
 *
 * A task-agnostic inference paradigm that enables Language Models to
 * programmatically examine, decompose, and recursively call themselves
 * over near-infinite length contexts.
 *
 * Uses the Vercel AI SDK for model-agnostic inference and an abstracted
 * sandbox layer for code execution (Docker, local, or custom backends).
 *
 * @example
 * ```typescript
 * import { RLM } from "rlm-ts";
 * import { openai } from "@ai-sdk/openai";
 *
 * const rlm = new RLM({
 *   model: openai("gpt-4o"),
 *   sandbox: "local",
 *   maxIterations: 30,
 *   verbose: true,
 * });
 *
 * const result = await rlm.completion(
 *   "Your large context here...",
 *   "What is the main theme?"
 * );
 *
 * console.log(result.response);
 * ```
 */

// Core
export { RLM } from "./core/rlm.js";
export type { RLMConfig } from "./core/types.js";
export type {
  RLMChatCompletion,
  RLMIteration,
  RLMMetadata,
  REPLResult,
  CodeBlock,
  UsageSummary,
  ModelUsageSummary,
  Message,
  SandboxType,
  QueryMetadata,
} from "./core/types.js";

// Sandboxes
export type { Sandbox, SupportsPersistence } from "./sandboxes/base.js";
export { supportsPersistence } from "./sandboxes/base.js";
export { LocalSandbox } from "./sandboxes/local.js";
export type { LocalSandboxOptions } from "./sandboxes/local.js";
export { DockerSandbox } from "./sandboxes/docker.js";
export type { DockerSandboxOptions } from "./sandboxes/docker.js";
export { createSandbox } from "./sandboxes/index.js";

// Logger
export { RLMLogger } from "./logger/rlm-logger.js";
export { VerbosePrinter } from "./logger/verbose.js";

// Utilities
export {
  RLM_SYSTEM_PROMPT,
  buildRlmSystemPrompt,
  buildUserPrompt,
} from "./utils/prompts.js";
export {
  findCodeBlocks,
  findFinalAnswer,
  formatIteration,
  formatExecutionResult,
} from "./utils/parsing.js";
export { filterSensitiveKeys } from "./utils/helpers.js";
