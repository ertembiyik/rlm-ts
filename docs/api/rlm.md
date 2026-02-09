---
layout: default
title: RLM Class
parent: API Reference
nav_order: 1
---

# RLM Class Reference
{: .no_toc }

Complete API documentation for the core RLM class.
{: .fs-6 .fw-300 }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

The `RLM` class is the main entry point for Recursive Language Model completions. It wraps an AI SDK model and execution sandbox to enable iterative, code-augmented reasoning.

```typescript
import { RLM } from "rlm-ts";
import { openai } from "@ai-sdk/openai";

const rlm = new RLM({
  model: openai("gpt-4o"),
});
```

---

## Constructor

```typescript
new RLM({
  model: LanguageModelV1,
  sandbox?: SandboxType,
  sandboxKwargs?: Record<string, unknown>,
  depth?: number,
  maxDepth?: number,
  maxIterations?: number,
  customSystemPrompt?: string,
  subModel?: LanguageModelV1,
  logger?: RLMLogger,
  verbose?: boolean,
  persistent?: boolean,
})
```

### Parameters

#### `model`
{: .no_toc }

**Type:** `LanguageModelV1` (from `ai` package)
**Required**

The AI SDK model instance for the root model. Any AI SDK-compatible provider works.

```typescript
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

new RLM({ model: openai("gpt-4o") });
new RLM({ model: anthropic("claude-sonnet-4-20250514") });
new RLM({ model: google("gemini-2.0-flash") });
```

---

#### `sandbox`
{: .no_toc }

**Type:** `"local" | "docker"`
**Default:** `"local"`

The execution sandbox for running generated code.

| Sandbox | Description |
|:--------|:------------|
| `local` | Python via child_process with JSON state persistence |
| `docker` | Python in Docker container with HTTP proxy |

---

#### `sandboxKwargs`
{: .no_toc }

**Type:** `Record<string, unknown> | undefined`
**Default:** `undefined`

Configuration for the execution sandbox:

**Docker:**
```typescript
sandboxKwargs: {
  image: "python:3.11-slim",  // Docker image
}
```

---

#### `maxDepth`
{: .no_toc }

**Type:** `number`
**Default:** `1`

Maximum recursion depth for nested RLM calls. Currently only depth 1 is fully supported.

When `depth >= maxDepth`, the RLM falls back to a regular LM completion.

---

#### `maxIterations`
{: .no_toc }

**Type:** `number`
**Default:** `30`

Maximum number of REPL iterations before forcing a final answer.

Each iteration consists of:
1. LM generates response (potentially with code blocks)
2. Code blocks are executed
3. Results are appended to conversation history

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  maxIterations: 50,
});
```

---

#### `customSystemPrompt`
{: .no_toc }

**Type:** `string | undefined`
**Default:** `undefined`

Override the default RLM system prompt. The default prompt instructs the LM on:
- How to use the `context` variable
- How to call `llm_query()` and `llm_query_batched()`
- How to signal completion with `FINAL()`

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  customSystemPrompt: `You are a data analysis expert.
Use the REPL to analyze the context variable.
When done, output FINAL(your answer).`,
});
```

---

#### `subModel`
{: .no_toc }

**Type:** `LanguageModelV1 | undefined`
**Default:** `undefined`

Optional AI SDK model for sub-calls (depth=1). Used when REPL code calls `llm_query()`.

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  subModel: openai("gpt-4o-mini"),
});

// Inside REPL, code can call:
// llm_query(prompt)                    # Uses default (gpt-4o)
// llm_query(prompt, "gpt-4o-mini")    # Uses sub-model
```

---

#### `logger`
{: .no_toc }

**Type:** `RLMLogger | undefined`
**Default:** `undefined`

Logger for saving iteration trajectories to disk.

```typescript
import { RLMLogger } from "rlm-ts";

const logger = new RLMLogger("./logs");
new RLM({ model: openai("gpt-4o"), logger });
```

---

#### `verbose`
{: .no_toc }

**Type:** `boolean`
**Default:** `false`

Enable console output showing:
- Metadata at startup
- Each iteration's response
- Code execution results
- Final answer and statistics

---

#### `persistent`
{: .no_toc }

**Type:** `boolean`
**Default:** `false`

Reuse the sandbox across `completion()` calls for multi-turn conversations. Currently only supported with the `local` sandbox.

When enabled, call `rlm.close()` when done to clean up resources.

---

## Methods

### `completion()`

Main entry point for RLM completions.

```typescript
async completion(
  prompt: string | Record<string, unknown>,
  rootPrompt?: string | null
): Promise<RLMChatCompletion>
```

#### Parameters

**`prompt`**
{: .no_toc }

The context/input to process. Becomes the `context` variable in the REPL.

```typescript
// String input
const result = await rlm.completion("Analyze this text...");

// Structured input (serialized to JSON)
const result = await rlm.completion({
  documents: [...],
  query: "Find relevant sections",
});
```

**`rootPrompt`**
{: .no_toc }

Optional short prompt shown to the root LM. Useful for Q&A tasks where the question should be visible throughout.

```typescript
const result = await rlm.completion(
  longDocument,
  "What is the main theme of this document?"
);
```

#### Returns

`RLMChatCompletion`:

```typescript
interface RLMChatCompletion {
  rootModel: string;           // Model ID used
  prompt: string | Record<string, unknown>;  // Original input
  response: string;            // Final answer
  usageSummary: UsageSummary;  // Token usage
  executionTime: number;       // Total seconds
}
```

#### Example

```typescript
const result = await rlm.completion(
  "Calculate the factorial of 100 and return the number of digits."
);

console.log(result.response);       // "158"
console.log(result.executionTime);   // 12.34
console.log(result.usageSummary);
// { modelUsageSummaries: { "gpt-4o": { totalCalls: 5, ... } } }
```

---

### `close()`

Clean up persistent sandbox resources. Call when done with multi-turn conversations.

```typescript
async close(): Promise<void>
```

---

## Response Types

### `RLMChatCompletion`

```typescript
interface RLMChatCompletion {
  rootModel: string;
  prompt: string | Record<string, unknown> | Message[];
  response: string;
  usageSummary: UsageSummary;
  executionTime: number;
}
```

### `UsageSummary`

```typescript
interface UsageSummary {
  modelUsageSummaries: Record<string, ModelUsageSummary>;
}

interface ModelUsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}
```

---

## Error Handling

RLM follows a "fail fast" philosophy:

```typescript
// Persistent mode with unsupported sandbox
const rlm = new RLM({
  model: openai("gpt-4o"),
  sandbox: "docker",
  persistent: true,
});
// Throws: Error: persistent=true is not supported for sandbox type 'docker'
```

If the RLM exhausts `maxIterations` without finding a `FINAL()` answer, it prompts the LM one more time to provide a final answer based on the conversation history.

---

## Thread Safety

Each `completion()` call:
1. Spawns its own `LMHandler` HTTP server
2. Creates a fresh sandbox instance (unless `persistent=true`)
3. Cleans up both when done

---

## Example: Full Configuration

```typescript
import { RLM, RLMLogger } from "rlm-ts";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";

const logger = new RLMLogger("./logs", "analysis");

const rlm = new RLM({
  // Primary model
  model: anthropic("claude-sonnet-4-20250514"),

  // Execution sandbox
  sandbox: "docker",
  sandboxKwargs: {
    image: "python:3.11-slim",
  },

  // Sub-model for recursive calls
  subModel: openai("gpt-4o-mini"),

  // Behavior
  maxIterations: 40,
  maxDepth: 1,

  // Debugging
  logger,
  verbose: true,
});

const result = await rlm.completion(
  massiveDocument,
  "Summarize the key findings"
);
```
