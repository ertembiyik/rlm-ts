/**
 * Sandbox factory and exports.
 *
 * Mirrors rlm/environments/__init__.py
 */

export type { Sandbox, SupportsPersistence } from "./base.js";
export { supportsPersistence } from "./base.js";
export { LocalSandbox } from "./local.js";
export type { LocalSandboxOptions } from "./local.js";
export { DockerSandbox } from "./docker.js";
export type { DockerSandboxOptions } from "./docker.js";

import type { Sandbox } from "./base.js";
import type { SandboxType } from "../core/types.js";
import { LocalSandbox } from "./local.js";
import { DockerSandbox } from "./docker.js";

/**
 * Create a sandbox from a type string and options.
 */
export async function createSandbox(
  type: SandboxType,
  options: Record<string, unknown> = {}
): Promise<Sandbox> {
  switch (type) {
    case "local":
      return new LocalSandbox(options);
    case "docker": {
      const sandbox = new DockerSandbox(options);
      await sandbox.setup();
      return sandbox;
    }
    default:
      throw new Error(
        `Unknown sandbox type: ${type}. Supported: ['local', 'docker']. ` +
          `Implement the Sandbox interface for custom backends.`
      );
  }
}
