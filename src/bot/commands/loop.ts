import { CommandContext, Context } from "grammy";
import { loopManager } from "../../loop/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { logger } from "../../utils/logger.js";
import { t } from "../../i18n/index.js";

function parseLoopArgs(argsText: string): { prompt: string; maxIterations?: number } | null {
  const trimmed = argsText.trim();
  if (!trimmed) {
    return null;
  }

  const maxIterationsMatch = trimmed.match(/^(\d+):\s*/);
  if (maxIterationsMatch) {
    const maxIterations = parseInt(maxIterationsMatch[1], 10);
    const prompt = trimmed.slice(maxIterationsMatch[0].length).trim();
    if (!prompt || maxIterations < 1) {
      return null;
    }
    return { prompt, maxIterations };
  }

  return { prompt: trimmed };
}

export async function loopCommand(ctx: CommandContext<Context>): Promise<void> {
  const argsText = ctx.match;

  if (!argsText || typeof argsText !== "string") {
    await ctx.reply(t("loop.usage"));
    return;
  }

  const parsed = parseLoopArgs(argsText);
  if (!parsed) {
    await ctx.reply(t("loop.usage"));
    return;
  }

  const project = getCurrentProject();
  if (!project) {
    await ctx.reply(t("bot.project_not_selected"));
    return;
  }

  try {
    const config = loopManager.start(parsed.prompt, parsed.maxIterations);

    const maxIterationsInfo =
      config.maxIterations === 100 ? "" : `\n🔢 Max iterations: ${config.maxIterations}`;

    await ctx.reply(
      `🔄 Loop started!\n` +
        `📝 Prompt: ${parsed.prompt.slice(0, 100)}${parsed.prompt.length > 100 ? "..." : ""}\n` +
        `⏱️ Delay: 10 seconds between iterations${maxIterationsInfo}\n\n` +
        `Use /stop_loop to stop.`,
    );

    logger.info(`[LoopCommand] Loop started by user, maxIterations=${config.maxIterations}`);
  } catch (error) {
    if (error instanceof Error && error.message.includes("already active")) {
      await ctx.reply(t("loop.already_active"));
      return;
    }
    throw error;
  }
}

export async function stopLoopCommand(ctx: CommandContext<Context>): Promise<void> {
  const config = loopManager.stop();

  if (!config) {
    await ctx.reply(t("loop.not_active"));
    return;
  }

  const elapsed = Math.round((Date.now() - config.startedAt) / 1000 / 60);

  await ctx.reply(
    `⏹️ Loop stopped!\n` +
      `🔄 Completed iterations: ${config.currentIteration}\n` +
      `⏱️ Total time: ${elapsed} minutes`,
  );

  logger.info(`[LoopCommand] Loop stopped by user after ${config.currentIteration} iterations`);
}

export async function loopStatusCommand(ctx: CommandContext<Context>): Promise<void> {
  const config = loopManager.getConfig();

  if (!config || !config.isActive) {
    await ctx.reply(t("loop.not_active"));
    return;
  }

  const iteration = config.currentIteration;
  const remaining = config.maxIterations - iteration;
  const elapsed = Math.round((Date.now() - config.startedAt) / 1000 / 60);

  await ctx.reply(
    `🔄 Loop Status\n` +
      `📊 Current iteration: ${iteration}/${config.maxIterations}\n` +
      `⏱️ Elapsed: ${elapsed} minutes\n` +
      `📈 Remaining: ${remaining} iterations\n` +
      `📝 Prompt: ${config.prompt.slice(0, 100)}${config.prompt.length > 100 ? "..." : ""}`,
  );
}
