# AGENTS.md

This guide covers best practices for contributing to the TypeScript Recursive Language Models `rlm` package and developing new sandboxes (in `src/sandboxes/`) and LM integrations.

## Setup

```bash
# Install dependencies
bun install

# Build
bun run build

# Watch mode for development
bun run dev
```

## General Guidelines

### Code Style & Typing
- **Formatting**: Strict TypeScript with `strict: true` in tsconfig
- **Typing**: Explicit types preferred
  - **OK**: Type assertions with `as`, type guards
  - **NOT OK**: `@ts-ignore` without strong justification
- **Module system**: ESM (`"type": "module"` in package.json), use `.js` extensions in imports

### Naming Conventions
- **Methods/functions**: camelCase
- **Classes**: PascalCase (e.g., `LocalSandbox`, `DockerSandbox`)
- **Variables**: camelCase
- **Constants**: UPPER_CASE (e.g., `RLM_SYSTEM_PROMPT`)
- **Interfaces/types**: PascalCase (e.g., `RLMConfig`, `SandboxType`)

Do NOT use `_` prefix for private methods unless explicitly requested.

### Error Handling Philosophy
- **Fail fast, fail loud** - No defensive programming or silent fallbacks
- **Minimize branching** - Prefer single code paths; every `if`/`try` needs justification
- **Example**: Missing config → immediate `Error`, not graceful fallback

## Core Repository Development

```bash
git clone https://github.com/alexzhang13/rlm.git
cd rlm
bun install
bun run build
```

### Dependencies
- Avoid new core dependencies
- The AI SDK (`ai` package) and provider packages (`@ai-sdk/*`) are the core inference layer
- Exception: tiny deps that simplify widely-used code

### Testing
- Write simple, deterministic unit tests
- Update tests when changing functionality
- For sandbox environments, mock external services

### Documentation
- Keep concise and actionable
- Update README when behavior changes
- Avoid content duplication

### Scope
- Small, focused diffs
- One change per PR
- Delete dead code (don't guard it)

## Architecture

### AI SDK Integration
The RLM engine uses the [Vercel AI SDK](https://sdk.vercel.ai/) (`ai` package) for model-agnostic LLM inference. Instead of per-provider client classes, all providers are accessed via `LanguageModelV1`:

```typescript
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

const rlm = new RLM({
  model: openai("gpt-4o"),         // Primary model
  subModel: anthropic("claude-sonnet-4-20250514"), // Optional sub-call model
});
```

To add a new provider, install its AI SDK package (e.g., `bun add @ai-sdk/google`) — no custom client code needed.

### LM Handler
The `LMHandler` (in `src/core/lm-handler.ts`) runs an HTTP server that sandboxes call to make LLM requests. It wraps AI SDK `generateText()` calls and tracks usage per model.

## Developing Sandboxes

Sandbox implementations live in `src/sandboxes/`. All sandboxes must implement the `Sandbox` interface from `src/sandboxes/base.ts`.

### Sandbox Interface

```typescript
interface Sandbox {
  setup(): Promise<void> | void;
  loadContext(contextPayload: string | Record<string, unknown> | unknown[]): Promise<void> | void;
  executeCode(code: string): REPLResult | Promise<REPLResult>;
  cleanup(): Promise<void> | void;
}
```

### Persistence Extension

For multi-turn support, sandboxes can optionally implement `SupportsPersistence`:

```typescript
interface SupportsPersistence {
  updateHandlerAddress(address: { host: string; port: number }): void;
  addContext(contextPayload: string | Record<string, unknown> | unknown[], contextIndex?: number): Promise<number> | number;
  getContextCount(): number;
  addHistory(messageHistory: Message[], historyIndex?: number): number;
  getHistoryCount(): number;
}
```

### Requirements
- Implement all `Sandbox` methods
- Return `REPLResult` from `executeCode`
- Handle LM handler communication (the sandbox's Python REPL calls `llm_query()` via HTTP)
- Implement `cleanup()` for resource management
- Register sandbox in `src/sandboxes/index.ts`

### Key Implementation Details
- `setup()`: Initialize the execution environment (temp dirs, containers, etc.)
- `loadContext()`: Make context available as `context` variable in the Python REPL
- `executeCode()`: Execute Python code, capture stdout/stderr, return `REPLResult`
- Sandbox Python scripts must provide `llm_query`, `llm_query_batched`, `FINAL_VAR`, and `SHOW_VARS` functions

### Current Sandboxes

| Sandbox | File | Description |
|---------|------|-------------|
| `LocalSandbox` | `src/sandboxes/local.ts` | Executes Python via `child_process`, JSON state persistence |
| `DockerSandbox` | `src/sandboxes/docker.ts` | Executes Python in Docker container, HTTP proxy for LM calls |

### Checklist
- Sandbox implements the `Sandbox` interface
- Works with basic RLM completion calls
- `cleanup()` properly releases all resources
- Sub-LM calls work via `llm_query()`
