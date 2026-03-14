import type { Bot } from "grammy";
import { opencodeClient } from "../opencode/client.js";
import { getCurrentProject, setCurrentSession } from "../settings/manager.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { getStoredAgent } from "../agent/manager.js";
import { getStoredModel } from "../model/manager.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { logger } from "../utils/logger.js";

export interface LoopConfig {
  prompt: string;
  maxIterations: number;
  currentIteration: number;
  delayMs: number;
  isActive: boolean;
  startedAt: number;
}

export interface IterationRecord {
  iteration: number;
  sessionId: string;
  startedAt: number;
  completedAt: number | null;
}

export interface LoopStatus {
  config: LoopConfig;
  currentSessionId: string | null;
  isProcessing: boolean;
  iterationHistory: IterationRecord[];
}

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_DELAY_MS = 10_000;
const MAX_HISTORY = 10;

class LoopManager {
  private config: LoopConfig | null = null;
  private bot: Bot | null = null;
  private chatId: number | null = null;
  private ensureEventSubscription: ((directory: string) => Promise<void>) | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private currentSessionId: string | null = null;
  private isProcessing: boolean = false;
  private iterationHistory: IterationRecord[] = [];

  initialize(
    bot: Bot,
    chatId: number,
    ensureEventSubscription: (directory: string) => Promise<void>,
  ): void {
    this.bot = bot;
    this.chatId = chatId;
    this.ensureEventSubscription = ensureEventSubscription;
  }

  start(prompt: string, maxIterations?: number): LoopConfig {
    if (this.config?.isActive) {
      throw new Error("Loop already active. Use /stop_loop first.");
    }

    this.iterationHistory = [];
    this.currentSessionId = null;
    this.isProcessing = false;

    this.config = {
      prompt,
      maxIterations: maxIterations ?? DEFAULT_MAX_ITERATIONS,
      currentIteration: 0,
      delayMs: DEFAULT_DELAY_MS,
      isActive: true,
      startedAt: Date.now(),
    };

    logger.info(
      `[LoopManager] Started loop: maxIterations=${this.config.maxIterations}, prompt length=${prompt.length}`,
    );

    return this.config;
  }

  stop(): LoopConfig | null {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    const previousConfig = this.config;
    this.config = null;
    this.currentSessionId = null;
    this.isProcessing = false;

    if (previousConfig) {
      logger.info(`[LoopManager] Stopped loop after ${previousConfig.currentIteration} iterations`);
    }

    return previousConfig;
  }

  getConfig(): LoopConfig | null {
    return this.config;
  }

  isActive(): boolean {
    return this.config?.isActive ?? false;
  }

  getStatus(): LoopStatus | null {
    if (!this.config || !this.config.isActive) {
      return null;
    }

    return {
      config: { ...this.config },
      currentSessionId: this.currentSessionId,
      isProcessing: this.isProcessing,
      iterationHistory: [...this.iterationHistory],
    };
  }

  /**
   * Trigger the first iteration immediately after /loop starts.
   * This avoids waiting for a session.idle event that may never come.
   */
  async triggerFirstIteration(): Promise<void> {
    if (!this.config?.isActive || !this.bot || !this.chatId || !this.ensureEventSubscription) {
      logger.warn("[LoopManager] Cannot trigger first iteration: not properly initialized");
      return;
    }

    logger.info("[LoopManager] Triggering first iteration immediately");
    await this.executeNextIteration();
  }

  async onSessionIdle(): Promise<void> {
    if (!this.config?.isActive) {
      return;
    }

    // Mark current iteration as completed
    this.isProcessing = false;
    if (this.iterationHistory.length > 0) {
      const lastRecord = this.iterationHistory[this.iterationHistory.length - 1];
      if (!lastRecord.completedAt) {
        lastRecord.completedAt = Date.now();
      }
    }

    const currentConfig = this.config;
    currentConfig.currentIteration++;

    logger.info(
      `[LoopManager] Session idle, iteration ${currentConfig.currentIteration}/${currentConfig.maxIterations}`,
    );

    if (currentConfig.currentIteration >= currentConfig.maxIterations) {
      logger.info(
        `[LoopManager] Max iterations (${currentConfig.maxIterations}) reached, stopping loop`,
      );
      await this.sendLoopCompleteMessage(currentConfig);
      this.stop();
      return;
    }

    this.timeoutId = setTimeout(() => {
      this.executeNextIteration().catch((err) => {
        logger.error("[LoopManager] Error in next iteration:", err);
      });
    }, currentConfig.delayMs);

    logger.debug(`[LoopManager] Scheduled next iteration in ${currentConfig.delayMs}ms`);
  }

  private async executeNextIteration(): Promise<void> {
    if (!this.config?.isActive || !this.bot || !this.chatId || !this.ensureEventSubscription) {
      return;
    }

    const project = getCurrentProject();
    if (!project) {
      logger.error("[LoopManager] No project selected, stopping loop");
      await this.sendErrorMessage("No project selected");
      this.stop();
      return;
    }

    try {
      const iterationNumber = this.config.currentIteration + 1;
      logger.info(`[LoopManager] Creating new session for iteration ${iterationNumber}`);

      const { data: session, error } = await opencodeClient.session.create({
        directory: project.worktree,
      });

      if (error || !session) {
        logger.error("[LoopManager] Failed to create session:", error);
        await this.sendErrorMessage("Failed to create new session");
        this.stop();
        return;
      }

      const sessionInfo = {
        id: session.id,
        title: session.title,
        directory: project.worktree,
      };

      setCurrentSession(sessionInfo);
      await ingestSessionInfoForCache(session);

      // Track iteration
      this.currentSessionId = session.id;
      this.isProcessing = true;
      this.iterationHistory.push({
        iteration: iterationNumber,
        sessionId: session.id,
        startedAt: Date.now(),
        completedAt: null,
      });
      if (this.iterationHistory.length > MAX_HISTORY) {
        this.iterationHistory.shift();
      }

      logger.info(`[LoopManager] Created new session: id=${session.id}, title="${session.title}"`);

      await this.ensureEventSubscription(project.worktree);
      summaryAggregator.setSession(session.id);
      summaryAggregator.setBotAndChatId(this.bot, this.chatId);

      const currentAgent = getStoredAgent();
      const storedModel = getStoredModel();

      const promptOptions: {
        sessionID: string;
        directory: string;
        parts: Array<{ type: "text"; text: string }>;
        model?: { providerID: string; modelID: string };
        agent?: string;
        variant?: string;
      } = {
        sessionID: session.id,
        directory: project.worktree,
        parts: [{ type: "text", text: this.config.prompt }],
        agent: currentAgent,
      };

      if (storedModel.providerID && storedModel.modelID) {
        promptOptions.model = {
          providerID: storedModel.providerID,
          modelID: storedModel.modelID,
        };
        if (storedModel.variant) {
          promptOptions.variant = storedModel.variant;
        }
      }

      logger.info(`[LoopManager] Sending prompt for iteration ${iterationNumber}`);

      await this.sendIterationStartMessage(iterationNumber);

      const { error: promptError } = await opencodeClient.session.prompt(promptOptions);

      if (promptError) {
        logger.error("[LoopManager] Failed to send prompt:", promptError);
        await this.sendErrorMessage("Failed to send prompt");
        this.stop();
        return;
      }

      logger.info(`[LoopManager] Prompt sent successfully for iteration ${iterationNumber}`);
    } catch (err) {
      logger.error("[LoopManager] Unexpected error in iteration:", err);
      await this.sendErrorMessage("Unexpected error occurred");
      this.stop();
    }
  }

  private async sendIterationStartMessage(iteration: number): Promise<void> {
    if (!this.bot || !this.chatId || !this.config) {
      return;
    }

    const elapsed = Math.round((Date.now() - this.config.startedAt) / 1000 / 60);
    const remaining = this.config.maxIterations - iteration;

    const message =
      `🔄 Loop iteration ${iteration}/${this.config.maxIterations} starting...\n` +
      `⏱️ Elapsed: ${elapsed} min | 📊 Remaining: ${remaining}`;

    await this.bot.api.sendMessage(this.chatId, message).catch((err) => {
      logger.error("[LoopManager] Failed to send iteration start message:", err);
    });
  }

  private async sendLoopCompleteMessage(config: LoopConfig): Promise<void> {
    if (!this.bot || !this.chatId) {
      return;
    }

    const elapsed = Math.round((Date.now() - config.startedAt) / 1000 / 60);

    const message = `✅ Loop completed!\n🔄 Total iterations: ${config.currentIteration}\n⏱️ Total time: ${elapsed} minutes\n\nUse /loop <prompt> to start a new loop.`;

    await this.bot.api.sendMessage(this.chatId, message).catch((err) => {
      logger.error("[LoopManager] Failed to send completion message:", err);
    });
  }

  private async sendErrorMessage(errorText: string): Promise<void> {
    if (!this.bot || !this.chatId) {
      return;
    }

    await this.bot.api
      .sendMessage(this.chatId, `❌ Loop error: ${errorText}\nLoop has been stopped.`)
      .catch((err) => {
        logger.error("[LoopManager] Failed to send error message:", err);
      });
  }

  clear(): void {
    this.stop();
    this.bot = null;
    this.chatId = null;
    this.ensureEventSubscription = null;
    this.iterationHistory = [];
  }
}

export const loopManager = new LoopManager();
