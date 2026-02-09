
---

<h1 align="center" style="font-size:2.8em">
<span>Recursive Language Models (<span style="color:orange">RLM</span>s)</span>
</h1>

<p align="center" style="font-size:1.3em">
  <a href="https://arxiv.org/abs/2512.24601">Full Paper</a> •
  <a href="https://alexzhang13.github.io/blog/2025/rlm/">Blogpost</a> •
  <a href="https://alexzhang13.github.io/rlm/">Documentation</a> •
  <a href="https://github.com/alexzhang13/rlm-minimal">RLM Minimal</a>
</p>

<p align="center">
  <a href="https://arxiv.org/abs/2512.24601">
    <img src="media/paper_preview.png" alt="Paper Preview" width="300"/>
  </a>
</p>

## Overview
Recursive Language Models (RLMs) are a task-agnostic inference paradigm for language models (LMs) to handle near-infinite length contexts by enabling the LM to *programmatically* examine, decompose, and recursively call itself over its input. RLMs replace the canonical `llm.completion(prompt, model)` call with a `rlm.completion(prompt, model)` call. RLMs offload the context as a variable in a REPL environment that the LM can interact with and launch sub-LM calls inside of.

This TypeScript implementation provides an extensible inference engine for using RLMs, built on the [Vercel AI SDK](https://sdk.vercel.ai/) for model-agnostic inference and an abstracted sandbox layer for code execution. The initial experiments and idea were proposed in a [blogpost](https://alexzhang13.github.io/blog/2025/rlm/) in 2025, with expanded results in an [arXiv preprint](https://arxiv.org/abs/2512.24601).

> [!NOTE]
> This is the TypeScript implementation of RLM. It uses the Vercel AI SDK for LLM inference (supporting any AI SDK-compatible provider) and Python-based REPL sandboxes for code execution.

## Quick Setup

```bash
bun add rlm
```

Requires [Bun](https://bun.sh/) and Python 3.11+ (for REPL sandbox execution).

```typescript
import { RLM } from "rlm";
import { openai } from "@ai-sdk/openai";

const rlm = new RLM({
  model: openai("gpt-5-nano"),
  verbose: true,
});

const result = await rlm.completion(
  "Print me the first 100 powers of two, each on a newline."
);
console.log(result.response);
```

<details>
<summary><b>Manual Setup</b></summary>

Clone the repository and install dependencies:
```bash
git clone https://github.com/alexzhang13/rlm.git
cd rlm
bun install
bun run build
```

</details>

## Sandbox Environments

RLM supports two sandbox types for executing LM-generated code. Both run Python REPL environments — the sandboxes provide isolation, not a language runtime.

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  sandbox: "local", // "local" | "docker"
});
```

### Local (Default)
The `local` sandbox executes Python code via `child_process` in a temporary directory. It uses JSON-based state persistence between code blocks and communicates with the LM handler over HTTP. Generally safe for local tasks, but not recommended for production with untrusted inputs.

### Docker <img src="https://github.com/docker.png" alt="Docker" height="20" style="vertical-align: middle;"/> (*requires [Docker installed](https://docs.docker.com/desktop/setup/install/)*)
The `docker` sandbox runs Python code inside a Docker container (`python:3.11-slim` by default). It uses a host-side HTTP proxy to bridge LM handler requests from inside the container.

```typescript
const rlm = new RLM({
  model: openai("gpt-4o"),
  sandbox: "docker",
  sandboxKwargs: { image: "python:3.11-slim" },
});
```

### Model Providers

This implementation uses the [Vercel AI SDK](https://sdk.vercel.ai/), so any AI SDK-compatible provider works out of the box:

```typescript
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

// OpenAI
new RLM({ model: openai("gpt-4o") });

// Anthropic
new RLM({ model: anthropic("claude-sonnet-4-20250514") });

// Google
new RLM({ model: google("gemini-2.0-flash") });
```

## Relevant Reading
* **[Dec '25]** [Recursive Language Models arXiv](https://arxiv.org/abs/2512.24601)
* **[Oct '25]** [Recursive Language Models Blogpost](https://alexzhang13.github.io/blog/2025/rlm/)

If you use this code or repository in your research, please cite:

```bibtex
@misc{zhang2025recursivelanguagemodels,
      title={Recursive Language Models},
      author={Alex L. Zhang and Tim Kraska and Omar Khattab},
      year={2025},
      eprint={2512.24601},
      archivePrefix={arXiv},
      primaryClass={cs.AI},
      url={https://arxiv.org/abs/2512.24601},
}
```

## Optional Debugging: Visualizing RLM Trajectories
We additionally provide a simple visualizer tool to examine and view the code, sub-LM, and root-LM calls of an RLM trajectory. To save log files (`.jsonl`) on every completion call that can be viewed in the visualizer, initialize the `RLMLogger` object and pass it into the `RLM` on initialization:
```typescript
import { RLM, RLMLogger } from "rlm";
import { openai } from "@ai-sdk/openai";

const logger = new RLMLogger("./logs");
const rlm = new RLM({
  model: openai("gpt-4o"),
  logger,
});
```

To run the visualizer locally:
```
cd visualizer/
bun run dev        # default localhost:3001
```

You'll have the option to select saved `.jsonl` files
<p align="center">
  <img src="media/visualizer.png" alt="RLM Visualizer Example" width="800"/>
</p>
