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

const DEFAULT_MAX_ITERATIONS = 100;
const DEFAULT_DELAY_MS = 10_000;

class LoopManager {
  private config: LoopConfig | null = null;
  private bot: Bot | null = null;
  private chatId: number | null = null;
  private ensureEventSubscription: ((directory: string) => Promise<void>) | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

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

  async onSessionIdle(): Promise<void> {
    if (!this.config?.isActive) {
      return;
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
      logger.info(
        `[LoopManager] Creating new session for iteration ${this.config.currentIteration + 1}`,
      );

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

      logger.info(`[LoopManager] Sending prompt for iteration ${this.config.currentIteration + 1}`);

      const { error: promptError } = await opencodeClient.session.prompt(promptOptions);

      if (promptError) {
        logger.error("[LoopManager] Failed to send prompt:", promptError);
        await this.sendErrorMessage("Failed to send prompt");
        this.stop();
        return;
      }

      await this.sendIterationStatus(this.config);

      logger.info(
        `[LoopManager] Prompt sent successfully for iteration ${this.config.currentIteration + 1}`,
      );
    } catch (err) {
      logger.error("[LoopManager] Unexpected error in iteration:", err);
      await this.sendErrorMessage("Unexpected error occurred");
      this.stop();
    }
  }

  private async sendIterationStatus(config: LoopConfig): Promise<void> {
    if (!this.bot || !this.chatId) {
      return;
    }

    const iteration = config.currentIteration + 1;
    const remaining = config.maxIterations - iteration;
    const elapsed = Math.round((Date.now() - config.startedAt) / 1000 / 60);

    const message = `🔄 Loop iteration ${iteration}/${config.maxIterations}\n⏱️ Elapsed: ${elapsed} minutes\n📊 Remaining: ${remaining} iterations`;

    await this.bot.api.sendMessage(this.chatId, message).catch((err) => {
      logger.error("[LoopManager] Failed to send status message:", err);
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
  }
}

export const loopManager = new LoopManager();
