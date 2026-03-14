import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { loopManager, type LoopConfig } from "../../src/loop/manager.js";

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: vi.fn(),
      prompt: vi.fn(),
    },
  },
}));

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => ({ name: "test-project", worktree: "/test/path" })),
  setCurrentSession: vi.fn(),
}));

vi.mock("../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: vi.fn(),
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => undefined),
}));

vi.mock("../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "", modelID: "", variant: undefined })),
}));

vi.mock("../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: vi.fn(),
    setBotAndChatId: vi.fn(),
    clear: vi.fn(),
  },
}));

describe("loopManager", () => {
  const mockBot = {
    api: {
      sendMessage: vi.fn().mockResolvedValue({}),
    },
  } as any;

  const mockChatId = 12345;
  const mockEnsureEventSubscription = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockBot.api.sendMessage = vi.fn().mockResolvedValue({});
    loopManager.clear();
  });

  afterEach(() => {
    loopManager.clear();
  });

  describe("start", () => {
    it("starts a loop with default settings", () => {
      const config = loopManager.start("Test prompt");

      expect(config.prompt).toBe("Test prompt");
      expect(config.maxIterations).toBe(100);
      expect(config.currentIteration).toBe(0);
      expect(config.delayMs).toBe(10_000);
      expect(config.isActive).toBe(true);
      expect(config.startedAt).toBeTypeOf("number");
      expect(loopManager.isActive()).toBe(true);
    });

    it("starts a loop with custom max iterations", () => {
      const config = loopManager.start("Test prompt", 50);

      expect(config.maxIterations).toBe(50);
    });

    it("throws error when loop is already active", () => {
      loopManager.start("First prompt");

      expect(() => loopManager.start("Second prompt")).toThrow(
        "Loop already active. Use /stop_loop first.",
      );
    });
  });

  describe("stop", () => {
    it("stops an active loop", () => {
      loopManager.start("Test prompt");
      const previousConfig = loopManager.stop();

      expect(previousConfig).not.toBeNull();
      expect(previousConfig?.isActive).toBe(true);
      expect(loopManager.isActive()).toBe(false);
    });

    it("returns null when no loop is active", () => {
      const previousConfig = loopManager.stop();

      expect(previousConfig).toBeNull();
    });
  });

  describe("getConfig", () => {
    it("returns current config when loop is active", () => {
      loopManager.start("Test prompt", 25);
      const config = loopManager.getConfig();

      expect(config).not.toBeNull();
      expect(config?.prompt).toBe("Test prompt");
      expect(config?.maxIterations).toBe(25);
    });

    it("returns null when no loop is active", () => {
      const config = loopManager.getConfig();

      expect(config).toBeNull();
    });
  });

  describe("isActive", () => {
    it("returns true when loop is active", () => {
      loopManager.start("Test prompt");

      expect(loopManager.isActive()).toBe(true);
    });

    it("returns false when no loop is active", () => {
      expect(loopManager.isActive()).toBe(false);
    });
  });

  describe("initialize", () => {
    it("stores bot, chatId, and ensureEventSubscription", () => {
      loopManager.initialize(mockBot, mockChatId, mockEnsureEventSubscription);

      expect(loopManager.isActive()).toBe(false);
    });
  });

  describe("onSessionIdle", () => {
    beforeEach(() => {
      loopManager.initialize(mockBot, mockChatId, mockEnsureEventSubscription);
    });

    it("does nothing when no loop is active", async () => {
      await loopManager.onSessionIdle();

      expect(mockBot.api.sendMessage).not.toHaveBeenCalled();
    });

    it("increments iteration count on session idle", async () => {
      const { opencodeClient } = await import("../../src/opencode/client.js");
      const mockSessionCreate = opencodeClient.session.create as ReturnType<typeof vi.fn>;
      mockSessionCreate.mockResolvedValue({
        data: { id: "session-1", title: "Test Session" },
        error: undefined,
      });

      const { opencodeClient: client } = await import("../../src/opencode/client.js");
      const mockSessionPrompt = client.session.prompt as ReturnType<typeof vi.fn>;
      mockSessionPrompt.mockResolvedValue({ error: undefined });

      loopManager.start("Test prompt", 5);

      await loopManager.onSessionIdle();

      const config = loopManager.getConfig();
      expect(config?.currentIteration).toBe(1);
    });

    it("stops loop when max iterations reached", async () => {
      const { opencodeClient } = await import("../../src/opencode/client.js");
      const mockSessionCreate = opencodeClient.session.create as ReturnType<typeof vi.fn>;
      mockSessionCreate.mockResolvedValue({
        data: { id: "session-1", title: "Test Session" },
        error: undefined,
      });

      loopManager.start("Test prompt", 1);

      await loopManager.onSessionIdle();

      expect(loopManager.isActive()).toBe(false);
      expect(mockBot.api.sendMessage).toHaveBeenCalled();
    });
  });

  describe("clear", () => {
    it("resets all state", () => {
      loopManager.initialize(mockBot, mockChatId, mockEnsureEventSubscription);
      loopManager.start("Test prompt");

      loopManager.clear();

      expect(loopManager.isActive()).toBe(false);
      expect(loopManager.getConfig()).toBeNull();
    });
  });
});
