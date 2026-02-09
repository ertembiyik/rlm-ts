/**
 * Verbose console printer for RLM execution.
 *
 * Mirrors rlm/logger/verbose.py 1:1.
 *
 * Uses chalk for coloured output (no dependency on Python's rich library).
 * Falls back gracefully if chalk is unavailable.
 */

import type {
  CodeBlock,
  RLMIteration,
  RLMMetadata,
  UsageSummary,
} from "../core/types.js";
import { usageSummaryToDict } from "../core/types.js";

// ─── Colors (Tokyo Night theme) ────────────────────────────────────────────

let chalk: typeof import("chalk") | null = null;

async function loadChalk(): Promise<void> {
  try {
    chalk = await import("chalk");
  } catch {
    chalk = null;
  }
}

// Eagerly attempt to load chalk
const chalkReady = loadChalk();

function c(color: string, text: string): string {
  if (!chalk) return text;
  const defaultChalk = chalk.default ?? chalk;
  return defaultChalk.hex(color)(text);
}

function bold(color: string, text: string): string {
  if (!chalk) return text;
  const defaultChalk = chalk.default ?? chalk;
  return defaultChalk.hex(color).bold(text);
}

const COLORS = {
  primary: "#7AA2F7",
  secondary: "#BB9AF7",
  success: "#9ECE6A",
  warning: "#E0AF68",
  error: "#F7768E",
  text: "#A9B1D6",
  muted: "#565F89",
  accent: "#7DCFFF",
};

// ─── VerbosePrinter ────────────────────────────────────────────────────────

export class VerbosePrinter {
  private enabled: boolean;
  private iterationCount = 0;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  async ensureReady(): Promise<void> {
    await chalkReady;
  }

  printMetadata(metadata: RLMMetadata): void {
    if (!this.enabled) return;

    const model = metadata.rootModel;
    const sandbox = metadata.sandboxType;
    const maxIter = metadata.maxIterations;
    const maxDepth = metadata.maxDepth;
    const otherModels = metadata.otherModels;

    console.log();
    console.log(
      bold(COLORS.accent, "◆ ") +
      bold(COLORS.primary, "RLM") +
      c(COLORS.muted, " ━ Recursive Language Model")
    );
    console.log(c(COLORS.muted, "─".repeat(60)));

    console.log(
      `  ${c(COLORS.muted, "Model")}          ${c(COLORS.accent, model)}`
    );
    console.log(
      `  ${c(COLORS.muted, "Sandbox")}        ${c(COLORS.secondary, sandbox)}`
    );
    console.log(
      `  ${c(COLORS.muted, "Max Iterations")} ${c(COLORS.warning, String(maxIter))}`
    );
    console.log(
      `  ${c(COLORS.muted, "Max Depth")}      ${c(COLORS.warning, String(maxDepth))}`
    );

    if (otherModels && otherModels.length > 0) {
      console.log(
        `  ${c(COLORS.muted, "Sub-models")}     ${c(COLORS.secondary, otherModels.join(", "))}`
      );
    }

    console.log(c(COLORS.muted, "─".repeat(60)));
    console.log();
  }

  printIteration(iteration: RLMIteration, iterationNum: number): void {
    if (!this.enabled) return;

    this.iterationCount = iterationNum;

    // Iteration header
    console.log(
      c(COLORS.muted, "───") +
      bold(COLORS.primary, ` Iteration ${iterationNum} `) +
      c(COLORS.muted, "───")
    );

    // LLM response
    const timeStr = iteration.iterationTime
      ? c(COLORS.muted, ` (${iteration.iterationTime.toFixed(2)}s)`)
      : "";
    console.log(
      bold(COLORS.accent, "◇ ") +
      bold(COLORS.primary, "LLM Response") +
      timeStr
    );

    const wordCount = iteration.response.split(/\s+/).length;
    const preview =
      iteration.response.length > 500
        ? iteration.response.slice(0, 500) + "..."
        : iteration.response;
    console.log(c(COLORS.text, preview));
    console.log(c(COLORS.muted, `~${wordCount} words`));

    // Code blocks
    for (const codeBlock of iteration.codeBlocks) {
      this.printCodeExecution(codeBlock);
    }
  }

  private printCodeExecution(codeBlock: CodeBlock): void {
    const result = codeBlock.result;
    const timeStr = result.executionTime
      ? c(COLORS.muted, ` (${result.executionTime.toFixed(3)}s)`)
      : "";

    console.log(
      bold(COLORS.success, "▸ ") +
      bold(COLORS.success, "Code Execution") +
      timeStr
    );

    // Code
    console.log(c(COLORS.muted, "Code:"));
    console.log(c(COLORS.text, codeBlock.code));

    // Stdout
    if (result.stdout.trim()) {
      console.log(c(COLORS.muted, "Output:"));
      console.log(c(COLORS.success, result.stdout));
    }

    // Stderr
    if (result.stderr.trim()) {
      console.log(c(COLORS.muted, "Error:"));
      console.log(c(COLORS.error, result.stderr));
    }

    // Sub-calls
    if (result.rlmCalls.length > 0) {
      console.log(
        c(COLORS.secondary, `  ↳ ${result.rlmCalls.length} sub-call(s)`)
      );

      for (const call of result.rlmCalls) {
        const callTime = call.executionTime
          ? c(COLORS.muted, ` (${call.executionTime.toFixed(2)}s)`)
          : "";
        console.log(
          c(COLORS.secondary, `    ↳ Sub-call: `) +
          c(COLORS.accent, call.rootModel) +
          callTime
        );
      }
    }
  }

  printFinalAnswer(answer: string): void {
    if (!this.enabled) return;

    console.log();
    console.log(
      bold(COLORS.warning, "★ ") +
      bold(COLORS.warning, "Final Answer")
    );
    console.log(c(COLORS.text, answer));
    console.log();
  }

  printSummary(
    totalIterations: number,
    totalTime: number,
    usageSummary?: UsageSummary | null
  ): void {
    if (!this.enabled) return;

    console.log(c(COLORS.muted, "═".repeat(60)));

    console.log(
      `  ${c(COLORS.muted, "Iterations")}    ${c(COLORS.accent, String(totalIterations))}`
    );
    console.log(
      `  ${c(COLORS.muted, "Total Time")}    ${c(COLORS.accent, `${totalTime.toFixed(2)}s`)}`
    );

    if (usageSummary) {
      const dict = usageSummaryToDict(usageSummary);
      const summaries = (dict.model_usage_summaries ?? {}) as Record<
        string,
        Record<string, number>
      >;

      let totalInput = 0;
      let totalOutput = 0;
      for (const model of Object.values(summaries)) {
        totalInput += model.total_input_tokens ?? 0;
        totalOutput += model.total_output_tokens ?? 0;
      }

      if (totalInput || totalOutput) {
        console.log(
          `  ${c(COLORS.muted, "Input Tokens")}  ${c(COLORS.accent, totalInput.toLocaleString())}`
        );
        console.log(
          `  ${c(COLORS.muted, "Output Tokens")} ${c(COLORS.accent, totalOutput.toLocaleString())}`
        );
      }
    }

    console.log(c(COLORS.muted, "═".repeat(60)));
    console.log();
  }
}
