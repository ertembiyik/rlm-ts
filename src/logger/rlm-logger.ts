/**
 * Logger for RLM iterations.
 *
 * Writes RLMIteration data to JSON-lines files for analysis and debugging.
 * Mirrors rlm/logger/rlm_logger.py 1:1.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { RLMIteration, RLMMetadata } from "../core/types.js";
import { rlmIterationToDict, rlmMetadataToDict } from "../core/types.js";

export class RLMLogger {
  readonly logDir: string;
  readonly logFilePath: string;
  private iterationCount = 0;
  private metadataLogged = false;

  constructor(logDir: string, fileName = "rlm") {
    this.logDir = logDir;
    fs.mkdirSync(logDir, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .replace(/[T]/g, "_")
      .replace(/[:]/g, "-")
      .slice(0, 19);
    const runId = crypto.randomUUID().slice(0, 8);
    this.logFilePath = path.join(logDir, `${fileName}_${timestamp}_${runId}.jsonl`);
  }

  logMetadata(metadata: RLMMetadata): void {
    if (this.metadataLogged) return;

    const entry = {
      type: "metadata",
      timestamp: new Date().toISOString(),
      ...rlmMetadataToDict(metadata),
    };

    fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + "\n", "utf-8");
    this.metadataLogged = true;
  }

  log(iteration: RLMIteration): void {
    this.iterationCount++;

    const entry = {
      type: "iteration",
      iteration: this.iterationCount,
      timestamp: new Date().toISOString(),
      ...rlmIterationToDict(iteration),
    };

    fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  getIterationCount(): number {
    return this.iterationCount;
  }
}
