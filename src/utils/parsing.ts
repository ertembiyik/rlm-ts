/**
 * Parsing utilities for RLM trajectories.
 *
 * Mirrors rlm/utils/parsing.py 1:1.
 */

import type { REPLResult, RLMIteration, Message } from "../core/types.js";
import type { Sandbox } from "../sandboxes/base.js";

/**
 * Find REPL code blocks in text wrapped in triple backticks with 'repl' language id.
 *
 * Returns an array of code strings (empty array if none found).
 */
export function findCodeBlocks(text: string): string[] {
  const pattern = /```repl\s*\n([\s\S]*?)\n```/g;
  const results: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    results.push(match[1].trim());
  }

  return results;
}

/**
 * Find FINAL(...) or FINAL_VAR(...) statement in response and return the final answer.
 *
 * If FINAL_VAR is found and a sandbox is provided, executes code to retrieve the variable.
 * Returns null if no final answer pattern is found.
 */
export function findFinalAnswer(
  text: string,
  sandbox?: Sandbox | null
): string | null {
  // Check for FINAL_VAR pattern first – must be at start of line
  const finalVarPattern = /^\s*FINAL_VAR\((.*?)\)/m;
  const varMatch = finalVarPattern.exec(text);
  if (varMatch) {
    const variableName = varMatch[1].trim().replace(/^["']|["']$/g, "");
    if (sandbox) {
      const result = sandbox.executeCode(
        `print(FINAL_VAR(${JSON.stringify(variableName)}))`
      );
      // executeCode may return REPLResult or Promise<REPLResult>.
      // For the local sandbox it's synchronous, so we handle that case.
      if (result && typeof result === "object" && !("then" in result)) {
        const syncResult = result as REPLResult;
        const finalAnswer = syncResult.stdout.trim();
        if (finalAnswer === "") {
          return syncResult.stderr.trim() || "";
        }
        return finalAnswer;
      }
    }
    return null;
  }

  // Check for FINAL pattern – must be at start of line
  // Use greedy matching to capture content with nested parentheses
  const finalPattern = /^\s*FINAL\((.*)\)\s*$/ms;
  const finalMatch = finalPattern.exec(text);
  if (finalMatch) {
    return finalMatch[1].trim();
  }

  return null;
}

/**
 * Format an RLM iteration to append to message history for the next iteration.
 *
 * Truncates execution results exceeding maxCharacterLength.
 */
export function formatIteration(
  iteration: RLMIteration,
  maxCharacterLength = 20000
): Message[] {
  const messages: Message[] = [
    { role: "assistant", content: iteration.response },
  ];

  for (const codeBlock of iteration.codeBlocks) {
    const code = codeBlock.code;
    let result = formatExecutionResult(codeBlock.result);

    if (result.length > maxCharacterLength) {
      result =
        result.slice(0, maxCharacterLength) +
        `... + [${result.length - maxCharacterLength} chars...]`;
    }

    messages.push({
      role: "user",
      content: `Code executed:\n\`\`\`python\n${code}\n\`\`\`\n\nREPL output:\n${result}`,
    });
  }

  return messages;
}

/**
 * Format an execution result as a string for display.
 */
export function formatExecutionResult(result: REPLResult): string {
  const parts: string[] = [];

  if (result.stdout) {
    parts.push(`\n${result.stdout}`);
  }

  if (result.stderr) {
    parts.push(`\n${result.stderr}`);
  }

  // Show variable names (excluding internal ones)
  const importantVars: string[] = [];
  for (const [key, value] of Object.entries(result.locals)) {
    if (key.startsWith("_")) continue;
    if (["__builtins__", "__name__", "__doc__"].includes(key)) continue;
    const t = typeof value;
    if (
      t === "string" ||
      t === "number" ||
      t === "boolean" ||
      Array.isArray(value) ||
      (t === "object" && value !== null)
    ) {
      importantVars.push(key);
    }
  }

  if (importantVars.length > 0) {
    parts.push(`REPL variables: [${importantVars.map((v) => `'${v}'`).join(", ")}]\n`);
  }

  return parts.length > 0 ? parts.join("\n\n") : "No output";
}
