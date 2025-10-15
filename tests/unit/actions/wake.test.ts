import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { wake } from "../../../src/actions/wake.js";
import type { IrisOrchestrator } from "../../../src/iris.js";
import type { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import type { SessionManager } from "../../../src/session/session-manager.js";
import type { ClaudeProcess } from "../../../src/process-pool/claude-process.js";
import { ConfigurationError } from "../../../src/utils/errors.js";

// Mock the logger
vi.mock("../../../src/utils/logger.js", () => ({
  getChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  }),
}));

// Mock the validation
vi.mock("../../../src/utils/validation.js", () => ({
  validateTeamName: vi.fn(),
}));

describe("wake", () => {
  let mockIris: IrisOrchestrator;
  let mockProcessPool: ClaudeProcessPool;
  let mockSessionManager: SessionManager;
  let mockProcess: ClaudeProcess;

  beforeEach(() => {
    // Setup mock process with new API
    mockProcess = {
      getBasicMetrics: vi.fn().mockReturnValue({
        teamName: "team-alpha",
        pid: 12345,
        uptime: 1000,
        isReady: true,
        isSpawning: false,
        isBusy: false,
      }),
    } as unknown as ClaudeProcess;

    // Setup mock Iris orchestrator
    mockIris = {} as IrisOrchestrator;

    // Setup mock process pool
    mockProcessPool = {
      getConfig: vi.fn().mockReturnValue({
        teams: {
          "team-alpha": {
            path: "/path/to/alpha",
            description: "Alpha team",
          },
          "team-beta": {
            path: "/path/to/beta",
            description: "Beta team",
          },
        },
      }),
      getProcess: vi.fn(),
      getOrCreateProcess: vi.fn(),
    } as unknown as ClaudeProcessPool;

    // Setup mock session manager
    mockSessionManager = {
      getOrCreateSession: vi.fn().mockResolvedValue({
        sessionId: "new-session-456",
        fromTeam: "team-beta",
        toTeam: "team-alpha",
        createdAt: new Date(),
      }),
      updateProcessState: vi.fn(),
    } as unknown as SessionManager;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("team already awake", () => {
    it("should return awake status for active team", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "awake",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockSessionManager.getOrCreateSession).not.toHaveBeenCalled();
      expect(mockProcessPool.getOrCreateProcess).not.toHaveBeenCalled();
    });

    it("should include fromTeam in logging context", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      expect(mockProcessPool.getProcess).toHaveBeenCalledWith("team-alpha");
    });
  });

  describe("waking asleep team", () => {
    beforeEach(() => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(undefined);
    });

    it("should wake up asleep team", async () => {
      const newProcess = {
        getBasicMetrics: vi.fn().mockReturnValue({
          teamName: "team-alpha",
          pid: 67890,
          uptime: 0,
          isReady: false,
          isSpawning: true,
          isBusy: false,
        }),
      } as unknown as ClaudeProcess;

      vi.mocked(mockProcessPool.getOrCreateProcess).mockResolvedValue(
        newProcess,
      );

      const result = await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "waking",
        message: "Team team-alpha is waking up and will be ready shortly",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });

      expect(mockSessionManager.getOrCreateSession).toHaveBeenCalledWith(
        "team-beta",
        "team-alpha",
      );
      expect(mockProcessPool.getOrCreateProcess).toHaveBeenCalledWith(
        "team-alpha",
        "new-session-456",
        "team-beta",
      );
    });

    it("should handle session creation failure", async () => {
      vi.mocked(mockSessionManager.getOrCreateSession).mockRejectedValue(
        new Error("Session creation failed"),
      );

      const result = await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "waking",
        message: "Failed to wake team team-alpha: Session creation failed",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it("should handle process creation failure", async () => {
      vi.mocked(mockProcessPool.getOrCreateProcess).mockRejectedValue(
        new Error("Process spawn failed"),
      );

      const result = await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      expect(result).toMatchObject({
        team: "team-alpha",
        status: "waking",
        message: "Failed to wake team team-alpha: Process spawn failed",
        duration: expect.any(Number),
        timestamp: expect.any(Number),
      });
    });

    it("should handle non-Error failures", async () => {
      vi.mocked(mockProcessPool.getOrCreateProcess).mockRejectedValue(
        "String error",
      );

      const result = await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      expect(result.message).toBe(
        "Failed to wake team team-alpha: String error",
      );
    });
  });

  describe("error handling", () => {
    it("should throw ConfigurationError for unknown team", async () => {
      await expect(
        wake(
          { team: "unknown-team", fromTeam: "team-beta" },
          mockIris,
          mockProcessPool,
          mockSessionManager,
        ),
      ).rejects.toThrow(ConfigurationError);

      await expect(
        wake(
          { team: "unknown-team", fromTeam: "team-beta" },
          mockIris,
          mockProcessPool,
          mockSessionManager,
        ),
      ).rejects.toThrow("Unknown team: unknown-team");
    });

    it("should propagate config errors", async () => {
      vi.mocked(mockProcessPool.getConfig).mockImplementation(() => {
        throw new Error("Config error");
      });

      await expect(
        wake(
          { team: "team-alpha", fromTeam: "team-beta" },
          mockIris,
          mockProcessPool,
          mockSessionManager,
        ),
      ).rejects.toThrow("Config error");
    });
  });

  describe("validation", () => {
    it("should validate team names", async () => {
      const { validateTeamName } = await import(
        "../../../src/utils/validation.js"
      );
      const mockValidate = vi.mocked(validateTeamName);

      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      expect(mockValidate).toHaveBeenCalledWith("team-alpha");
      expect(mockValidate).toHaveBeenCalledWith("team-beta");
    });
  });

  describe("timing and metrics", () => {
    it("should track operation duration", async () => {
      vi.mocked(mockProcessPool.getProcess).mockReturnValue(mockProcess);

      const result = await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should return metrics from existing process", async () => {
      const customMetrics = {
        teamName: "team-alpha",
        pid: 99999,
        uptime: 60000,
        isReady: true,
        isSpawning: false,
        isBusy: true,
      };

      const customProcess = {
        getBasicMetrics: vi.fn().mockReturnValue(customMetrics),
      } as unknown as ClaudeProcess;

      vi.mocked(mockProcessPool.getProcess).mockReturnValue(customProcess);

      const result = await wake(
        { team: "team-alpha", fromTeam: "team-beta" },
        mockIris,
        mockProcessPool,
        mockSessionManager,
      );

      // Process metrics are not returned in WakeOutput (pid removed)
      expect(result.status).toBe("awake");
    });
  });
});
