/**
 * RLM – Recursive Language Model.
 *
 * Main entry point for users. Mirrors rlm/core/rlm.py 1:1.
 *
 * Uses the Vercel AI SDK (`ai` package) for LLM inference instead of
 * per-provider client classes. All providers are accessed via LanguageModelV1.
 */

import { generateText, type LanguageModelV1 } from "ai";
import { LMHandler } from "./lm-handler.js";
import type {
  RLMConfig,
  RLMChatCompletion,
  RLMIteration,
  RLMMetadata,
  CodeBlock,
  REPLResult,
  Message,
  SandboxType,
  UsageSummary,
} from "./types.js";
import { buildQueryMetadata } from "./types.js";
import {
  type Sandbox,
  type SupportsPersistence,
  supportsPersistence,
  createSandbox,
} from "../sandboxes/index.js";
import { RLMLogger } from "../logger/rlm-logger.js";
import { VerbosePrinter } from "../logger/verbose.js";
import {
  RLM_SYSTEM_PROMPT,
  buildRlmSystemPrompt,
  buildUserPrompt,
} from "../utils/prompts.js";
import {
  findCodeBlocks,
  findFinalAnswer,
  formatIteration,
} from "../utils/parsing.js";
import { filterSensitiveKeys } from "../utils/helpers.js";

export class RLM {
  private model: LanguageModelV1;
  private subModel: LanguageModelV1 | null;
  private sandboxType: SandboxType;
  private sandboxKwargs: Record<string, unknown>;
  private depth: number;
  private maxDepth: number;
  private maxIterations: number;
  private systemPrompt: string;
  private logger: RLMLogger | null;
  private verbose: VerbosePrinter;
  private persistent: boolean;
  private persistentSandbox: (Sandbox & SupportsPersistence) | null = null;

  constructor(config: RLMConfig) {
    this.model = config.model;
    this.subModel = config.subModel ?? null;
    this.sandboxType = config.sandbox ?? "local";
    this.sandboxKwargs = config.sandboxKwargs ? { ...config.sandboxKwargs } : {};
    this.depth = config.depth ?? 0;
    this.maxDepth = config.maxDepth ?? 1;
    this.maxIterations = config.maxIterations ?? 30;
    this.systemPrompt = config.customSystemPrompt ?? RLM_SYSTEM_PROMPT;
    this.logger = config.logger ?? null;
    this.verbose = new VerbosePrinter(config.verbose ?? false);
    this.persistent = config.persistent ?? false;

    // Validate persistence support
    if (this.persistent) {
      this.validatePersistentSupport();
    }

    // Log metadata
    if (this.logger || config.verbose) {
      const metadata: RLMMetadata = {
        rootModel: this.model.modelId,
        maxDepth: this.maxDepth,
        maxIterations: this.maxIterations,
        sandboxType: this.sandboxType,
        sandboxKwargs: filterSensitiveKeys(this.sandboxKwargs),
        otherModels: this.subModel ? [this.subModel.modelId] : null,
      };
      if (this.logger) {
        this.logger.logMetadata(metadata);
      }
      this.verbose.printMetadata(metadata);
    }
  }

  /**
   * Main RLM completion call. Replaces a regular LM completion call.
   *
   * Spawns its own sandbox and LM handler for the duration of this call.
   */
  async completion(
    prompt: string | Record<string, unknown>,
    rootPrompt?: string | null
  ): Promise<RLMChatCompletion> {
    const timeStart = performance.now();

    // At max depth, fall back to plain LM call
    if (this.depth >= this.maxDepth) {
      return this.fallbackAnswer(prompt, timeStart);
    }

    // Create LM handler
    const lmHandler = new LMHandler(this.model, {
      subModel: this.subModel,
    });

    if (this.subModel) {
      lmHandler.registerModel(this.subModel.modelId, this.subModel);
    }

    await lmHandler.start();

    // Create or reuse sandbox
    let sandbox: Sandbox;
    if (this.persistent && this.persistentSandbox) {
      sandbox = this.persistentSandbox;
      this.persistentSandbox.updateHandlerAddress(lmHandler.address);
      await this.persistentSandbox.addContext(prompt as string | Record<string, unknown> | unknown[]);
    } else {
      const sandboxOpts: Record<string, unknown> = {
        ...this.sandboxKwargs,
        lmHandlerAddress: lmHandler.address,
        contextPayload: prompt,
        depth: this.depth + 1,
      };
      sandbox = await createSandbox(this.sandboxType, sandboxOpts);

      if (this.persistent && supportsPersistence(sandbox)) {
        this.persistentSandbox = sandbox;
      }
    }

    try {
      // Build initial message history
      const queryMetadata = buildQueryMetadata(
        prompt as string | Record<string, unknown> | unknown[]
      );
      let messageHistory = buildRlmSystemPrompt(this.systemPrompt, queryMetadata);

      for (let i = 0; i < this.maxIterations; i++) {
        // Determine context/history counts
        const contextCount = supportsPersistence(sandbox)
          ? sandbox.getContextCount()
          : 1;
        const historyCount = supportsPersistence(sandbox)
          ? sandbox.getHistoryCount()
          : 0;

        const currentPrompt: Message[] = [
          ...messageHistory,
          buildUserPrompt(rootPrompt ?? null, i, contextCount, historyCount),
        ];

        // Run one iteration
        const iteration = await this.completionTurn(
          currentPrompt,
          lmHandler,
          sandbox
        );

        // Check for final answer
        const finalAnswer = findFinalAnswer(iteration.response, sandbox);
        iteration.finalAnswer = finalAnswer;

        // Log iteration
        if (this.logger) {
          this.logger.log(iteration);
        }
        this.verbose.printIteration(iteration, i + 1);

        if (finalAnswer !== null) {
          const timeEnd = performance.now();
          const usage = lmHandler.getUsageSummary();
          this.verbose.printFinalAnswer(finalAnswer);
          this.verbose.printSummary(
            i + 1,
            (timeEnd - timeStart) / 1000,
            usage
          );

          // Store history in persistent sandbox
          if (this.persistent && supportsPersistence(sandbox)) {
            sandbox.addHistory(messageHistory);
          }

          return {
            rootModel: this.model.modelId,
            prompt,
            response: finalAnswer,
            usageSummary: usage,
            executionTime: (timeEnd - timeStart) / 1000,
          };
        }

        // Format iteration for next prompt
        const newMessages = formatIteration(iteration);
        messageHistory = [...messageHistory, ...newMessages];
      }

      // Out of iterations – force a final answer
      const timeEnd = performance.now();
      const finalAnswer = await this.defaultAnswer(messageHistory, lmHandler);
      const usage = lmHandler.getUsageSummary();
      this.verbose.printFinalAnswer(finalAnswer);
      this.verbose.printSummary(
        this.maxIterations,
        (timeEnd - timeStart) / 1000,
        usage
      );

      // Store history in persistent sandbox
      if (this.persistent && supportsPersistence(sandbox)) {
        sandbox.addHistory(messageHistory);
      }

      return {
        rootModel: this.model.modelId,
        prompt,
        response: finalAnswer,
        usageSummary: usage,
        executionTime: (timeEnd - timeStart) / 1000,
      };
    } finally {
      lmHandler.stop();
      if (!this.persistent) {
        await sandbox.cleanup();
      }
    }
  }

  /**
   * Perform a single iteration: prompt the model, execute code blocks.
   */
  private async completionTurn(
    prompt: Message[],
    lmHandler: LMHandler,
    sandbox: Sandbox
  ): Promise<RLMIteration> {
    const iterStart = performance.now();

    const response = await lmHandler.completion(prompt);
    const codeBlockStrs = findCodeBlocks(response);
    const codeBlocks: CodeBlock[] = [];

    for (const codeStr of codeBlockStrs) {
      const codeResult: REPLResult = await sandbox.executeCode(codeStr);
      codeBlocks.push({ code: codeStr, result: codeResult });
    }

    const iterationTime = (performance.now() - iterStart) / 1000;

    return {
      prompt,
      response,
      codeBlocks,
      iterationTime,
    };
  }

  /**
   * Default answer when iterations are exhausted.
   */
  private async defaultAnswer(
    messageHistory: Message[],
    lmHandler: LMHandler
  ): Promise<string> {
    const currentPrompt: Message[] = [
      ...messageHistory,
      {
        role: "assistant",
        content:
          "Please provide a final answer to the user's question based on the information provided.",
      },
    ];

    const response = await lmHandler.completion(currentPrompt);

    if (this.logger) {
      this.logger.log({
        prompt: currentPrompt,
        response,
        codeBlocks: [],
        finalAnswer: response,
      });
    }

    return response;
  }

  /**
   * Fallback when at max depth – just do a plain LM call.
   */
  private async fallbackAnswer(
    message: string | Record<string, unknown>,
    timeStart: number
  ): Promise<RLMChatCompletion> {
    const messages: Message[] =
      typeof message === "string"
        ? [{ role: "user", content: message }]
        : [{ role: "user", content: JSON.stringify(message) }];

    const result = await generateText({ model: this.model, messages });
    const timeEnd = performance.now();

    const inputTokens = result.usage?.promptTokens ?? 0;
    const outputTokens = result.usage?.completionTokens ?? 0;

    return {
      rootModel: this.model.modelId,
      prompt: message,
      response: result.text,
      usageSummary: {
        modelUsageSummaries: {
          [this.model.modelId]: {
            totalCalls: 1,
            totalInputTokens: inputTokens,
            totalOutputTokens: outputTokens,
          },
        },
      },
      executionTime: (timeEnd - timeStart) / 1000,
    };
  }

  private validatePersistentSupport(): void {
    const supported: SandboxType[] = ["local"];
    if (!supported.includes(this.sandboxType)) {
      throw new Error(
        `persistent=true is not supported for sandbox type '${this.sandboxType}'. ` +
          `Persistent mode requires sandboxes that implement updateHandlerAddress(), ` +
          `addContext(), and getContextCount(). ` +
          `Supported sandboxes: ${JSON.stringify(supported.sort())}`
      );
    }
  }

  /**
   * Clean up persistent sandbox. Call when done with multi-turn conversations.
   */
  async close(): Promise<void> {
    if (this.persistentSandbox) {
      await (this.persistentSandbox as Sandbox).cleanup();
      this.persistentSandbox = null;
    }
  }
}
