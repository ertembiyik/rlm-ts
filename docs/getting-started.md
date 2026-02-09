---
layout: default
title: Getting Started
nav_order: 2
---

# Getting Started
{: .no_toc }

A complete guide to installing and configuring RLM for your projects.
{: .fs-6 .fw-300 }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Installation

### Prerequisites

- [Bun](https://bun.sh/)
- Python 3.11 or higher (for REPL sandbox execution)
- An API key from a supported LLM provider (OpenAI, Anthropic, Google, etc.)

### Using Bun

```bash
bun add rlm
```

You'll also need at least one AI SDK provider package:

```bash
bun add @ai-sdk/openai    # For OpenAI models
bun add @ai-sdk/anthropic  # For Anthropic models
bun add @ai-sdk/google     # For Google models
```

### Optional: Docker Support

For containerized execution, ensure Docker is installed and running:

```bash
docker --version
```

---

## Your First RLM Call

### Step 1: Set Up API Keys

Set environment variables for your provider:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
```

Or use a `.env` file with `dotenv`:

```bash
# .env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

### Step 2: Basic Usage

```typescript
import { RLM } from "rlm";
import { openai } from "@ai-sdk/openai";

const rlm = new RLM({
  model: openai("gpt-4o"),
});

const result = await rlm.completion(
  "Calculate the 50th Fibonacci number using Python."
);
console.log(result.response);
```

### Step 3: Enable Verbose Output

See what the RLM is doing step by step:

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  verbose: true,
});
```

This will display:
- Each iteration's LM response
- Code blocks being executed
- Stdout/stderr from execution
- Final answer when reached

---

## Understanding the RLM Class

### Constructor Arguments

| Argument | Type | Default | Description |
|:---------|:-----|:--------|:------------|
| `model` | `LanguageModelV1` | *required* | AI SDK model instance |
| `sandbox` | `SandboxType` | `"local"` | Execution sandbox type |
| `sandboxKwargs` | `Record<string, unknown>` | `undefined` | Sandbox configuration |
| `maxDepth` | `number` | `1` | Maximum recursion depth |
| `maxIterations` | `number` | `30` | Max REPL iterations per call |
| `customSystemPrompt` | `string` | `undefined` | Override default system prompt |
| `subModel` | `LanguageModelV1` | `undefined` | Model for sub-calls via `llm_query()` |
| `logger` | `RLMLogger` | `undefined` | Logger for trajectory tracking |
| `verbose` | `boolean` | `false` | Enable console output |
| `persistent` | `boolean` | `false` | Reuse sandbox across calls |

### The `completion()` Method

```typescript
const result = await rlm.completion(
  "Your input text or context",
  "Optional: A short prompt visible to the root LM"
);
```

**Parameters:**
- `prompt`: The main context/input (string or object). This becomes the `context` variable in the REPL.
- `rootPrompt`: Optional hint shown to the root LM (useful for Q&A tasks).

**Returns:** `RLMChatCompletion` with:
- `response`: The final answer string
- `usageSummary`: Token usage statistics
- `executionTime`: Total time in seconds
- `rootModel`: Model ID used
- `prompt`: Original input

---

## Choosing a Sandbox

RLM supports two execution sandboxes. Both run Python REPLs for code execution.

### Local (Default)

Code runs via Python `child_process` with JSON-based state persistence.

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  sandbox: "local",
});
```

**Pros:** Fast, no setup required
**Cons:** Less isolation from host process

### Docker

Code runs in a Docker container with full isolation.

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  sandbox: "docker",
  sandboxKwargs: {
    image: "python:3.11-slim",
  },
});
```

**Pros:** Containerized isolation, reproducible
**Cons:** Requires Docker, slower startup

---

## Choosing a Provider

This implementation uses the [Vercel AI SDK](https://sdk.vercel.ai/), so any compatible provider works:

### OpenAI

```typescript
import { openai } from "@ai-sdk/openai";

const rlm = new RLM({
  model: openai("gpt-4o"),
});
```

### Anthropic

```typescript
import { anthropic } from "@ai-sdk/anthropic";

const rlm = new RLM({
  model: anthropic("claude-sonnet-4-20250514"),
});
```

### Google

```typescript
import { google } from "@ai-sdk/google";

const rlm = new RLM({
  model: google("gemini-2.0-flash"),
});
```

### Sub-Models for Recursive Calls

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  subModel: openai("gpt-4o-mini"),
});

// Inside the REPL, code can call:
// llm_query(prompt)         # Uses default (gpt-4o)
// llm_query(prompt, model)  # Uses sub-model
```

---

## Logging and Debugging

### Enable Logging

```typescript
import { RLM, RLMLogger } from "rlm";
import { openai } from "@ai-sdk/openai";

const logger = new RLMLogger("./logs");

const rlm = new RLM({
  model: openai("gpt-4o"),
  logger,
  verbose: true,
});

const result = await rlm.completion("...");
// Logs saved to ./logs/rlm_TIMESTAMP_UUID.jsonl
```

### Log File Format

Logs are JSON-lines files with:

```json
{"type": "metadata", "root_model": "gpt-4o", "max_iterations": 30, ...}
{"type": "iteration", "iteration": 1, "response": "...", "code_blocks": [...]}
{"type": "iteration", "iteration": 2, "response": "...", "final_answer": "..."}
```

### Visualizer

Use the included visualizer to explore trajectories:

```bash
cd visualizer/
bun install
bun run dev  # Opens at localhost:3001
```

Upload `.jsonl` log files to visualize:
- Iteration timeline
- Code execution results
- Sub-LM call traces
- Token usage

---

## Next Steps

- [API Reference](api/rlm.md) - Complete RLM class documentation
