/**
 * Abstract sandbox interface for RLM code execution environments.
 *
 * Mirrors rlm/environments/base_env.py – BaseEnv, IsolatedEnv, NonIsolatedEnv,
 * and SupportsPersistence.
 *
 * Any execution backend (Docker, Apple Virtualization Framework, Vercel Sandboxes,
 * local subprocess, etc.) implements the Sandbox interface.
 */

import type { REPLResult, Message } from "../core/types.js";

// ─── Core Sandbox Interface ────────────────────────────────────────────────

/**
 * Minimal sandbox contract. Every execution backend must implement this.
 */
export interface Sandbox {
  /** One-time initialisation (called by the constructor). */
  setup(): Promise<void> | void;

  /** Load initial context into the sandbox namespace. */
  loadContext(contextPayload: string | Record<string, unknown> | unknown[]): Promise<void> | void;

  /** Execute a code string inside the sandbox and return the result. */
  executeCode(code: string): REPLResult | Promise<REPLResult>;

  /** Tear down resources (temp dirs, containers, VMs, …). */
  cleanup(): Promise<void> | void;
}

// ─── Persistence Extension ─────────────────────────────────────────────────

/**
 * Optional persistence protocol for multi-turn sessions.
 *
 * Environments that support `persistent=true` must implement these methods.
 * Use `supportsPersistence(sandbox)` to check at runtime.
 */
export interface SupportsPersistence {
  /** Update the LM handler address between completion calls. */
  updateHandlerAddress(address: { host: string; port: number }): void;

  /**
   * Add a context payload, making it available as `context_N` in code.
   * Returns the index used.
   */
  addContext(
    contextPayload: string | Record<string, unknown> | unknown[],
    contextIndex?: number
  ): Promise<number> | number;

  /** Number of contexts loaded so far. */
  getContextCount(): number;

  /**
   * Store a conversation's message history as `history_N`.
   * Returns the index used.
   */
  addHistory(messageHistory: Message[], historyIndex?: number): number;

  /** Number of histories stored so far. */
  getHistoryCount(): number;
}

// ─── Type guard ────────────────────────────────────────────────────────────

export function supportsPersistence(
  sandbox: Sandbox
): sandbox is Sandbox & SupportsPersistence {
  const s = sandbox as unknown as Record<string, unknown>;
  return (
    typeof s.updateHandlerAddress === "function" &&
    typeof s.addContext === "function" &&
    typeof s.getContextCount === "function" &&
    typeof s.addHistory === "function" &&
    typeof s.getHistoryCount === "function"
  );
}
