/**
 * Unit tests for reboot action
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { reboot } from "../../../src/actions/reboot.js";
import type { IrisOrchestrator } from "../../../src/iris.js";
import type { SessionManager } from "../../../src/session/session-manager.js";
import type { ClaudeProcessPool } from "../../../src/process-pool/pool-manager.js";
import type { ClaudeProcess } from "../../../src/process-pool/claude-process.js";

describe("reboot action", () => {
  let mockIris: IrisOrchestrator;
  let mockSessionManager: SessionManager;
  let mockProcessPool: ClaudeProcessPool;

  beforeEach(() => {
    // Mock IrisOrchestrator
    mockIris = {
      getMessageCache: vi.fn().mockReturnValue(null),
    } as unknown as IrisOrchestrator;

    // Mock SessionManager
    mockSessionManager = {
      getSession: vi.fn(),
      deleteSession: vi.fn(),
      createSession: vi.fn(),
    } as unknown as SessionManager;

    // Mock ClaudeProcessPool
    mockProcessPool = {
      getProcessBySessionId: vi.fn(),
      getOrCreateProcess: vi.fn().mockResolvedValue({
        sessionId: "new-session-id",
      }),
    } as unknown as ClaudeProcessPool;
  });

  describe("validation", () => {
    it("should reject invalid toTeam name", async () => {
      await expect(
        reboot(
          { fromTeam: "team-iris", toTeam: "../invalid" },
          mockIris,
          mockSessionManager,
          mockProcessPool,
        ),
      ).rejects.toThrow();
    });

    it("should reject invalid fromTeam name", async () => {
      await expect(
        reboot(
          { fromTeam: "../../etc/passwd", toTeam: "team-alpha" },
          mockIris,
          mockSessionManager,
          mockProcessPool,
        ),
      ).rejects.toThrow();
    });
  });

  describe("no previous session", () => {
    beforeEach(() => {
      vi.mocked(mockSessionManager.getSession).mockReturnValue(null);
      vi.mocked(mockSessionManager.createSession).mockResolvedValue({
        sessionId: "new-session-id",
        fromTeam: "team-iris",
        toTeam: "team-alpha",
        status: "active",
        createdAt: new Date(),
        lastUsedAt: new Date(),
        messageCount: 0,
      });
    });

    it("should create first session when none exists", async () => {
      const result = await reboot(
        { fromTeam: "team-iris", toTeam: "team-alpha" },
        mockIris,
        mockSessionManager,
        mockProcessPool,
      );

      expect(result).toMatchObject({
        from: "team-iris",
        to: "team-alpha",
        hadPreviousSession: false,
        newSessionId: "new-session-id",
        processTerminated: false,
      });

      expect(result.message).toContain("First session created");
      expect(result.oldSessionId).toBeUndefined();
      expect(result.timestamp).toBeGreaterThan(0);

      // Should not try to delete or terminate anything
      expect(mockSessionManager.deleteSession).not.toHaveBeenCalled();
      expect(mockProcessPool.getProcessBySessionId).not.toHaveBeenCalled();
    });
  });

  describe("existing session without active process", () => {
    beforeEach(() => {
      vi.mocked(mockSessionManager.getSession).mockReturnValue({
        sessionId: "old-session-id",
        fromTeam: "team-iris",
        toTeam: "team-alpha",
        status: "active",
        createdAt: new Date(Date.now() - 60000),
        lastUsedAt: new Date(),
        messageCount: 5,
      });

      vi.mocked(mockProcessPool.getProcessBySessionId).mockReturnValue(
        undefined,
      );

      vi.mocked(mockSessionManager.deleteSession).mockResolvedValue(undefined);
      vi.mocked(mockSessionManager.createSession).mockResolvedValue({
        sessionId: "new-session-id",
        fromTeam: "team-iris",
        toTeam: "team-alpha",
        status: "active",
        createdAt: new Date(),
        lastUsedAt: new Date(),
        messageCount: 0,
      });
    });

    it("should delete old session and create new one", async () => {
      const result = await reboot(
        { fromTeam: "team-iris", toTeam: "team-alpha" },
        mockIris,
        mockSessionManager,
        mockProcessPool,
      );

      expect(result).toMatchObject({
        from: "team-iris",
        to: "team-alpha",
        hadPreviousSession: true,
        oldSessionId: "old-session-id",
        newSessionId: "new-session-id",
        processTerminated: false,
      });

      expect(result.message).toContain("Fresh new session created");
      expect(result.message).toContain("old-session-id");

      // Should delete old session with filesystem cleanup
      expect(mockSessionManager.deleteSession).toHaveBeenCalledWith(
        "old-session-id",
        true,
      );

      // Should create new session
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(
        "team-iris",
        "team-alpha",
      );
    });
  });

  describe("existing session with active process", () => {
    let mockProcess: ClaudeProcess;

    beforeEach(() => {
      mockProcess = {
        terminate: vi.fn().mockResolvedValue(undefined),
      } as unknown as ClaudeProcess;

      vi.mocked(mockSessionManager.getSession).mockReturnValue({
        sessionId: "old-session-id",
        fromTeam: "team-iris",
        toTeam: "team-alpha",
        status: "active",
        createdAt: new Date(Date.now() - 60000),
        lastUsedAt: new Date(),
        messageCount: 10,
      });

      vi.mocked(mockProcessPool.getProcessBySessionId).mockReturnValue(
        mockProcess,
      );

      vi.mocked(mockSessionManager.deleteSession).mockResolvedValue(undefined);
      vi.mocked(mockSessionManager.createSession).mockResolvedValue({
        sessionId: "new-session-id",
        fromTeam: "team-iris",
        toTeam: "team-alpha",
        status: "active",
        createdAt: new Date(),
        lastUsedAt: new Date(),
        messageCount: 0,
      });
    });

    it("should terminate process, delete session, and create new one", async () => {
      const result = await reboot(
        { fromTeam: "team-iris", toTeam: "team-alpha" },
        mockIris,
        mockSessionManager,
        mockProcessPool,
      );

      expect(result).toMatchObject({
        from: "team-iris",
        to: "team-alpha",
        hadPreviousSession: true,
        oldSessionId: "old-session-id",
        newSessionId: "new-session-id",
        processTerminated: true,
      });

      // Should terminate process first
      expect(mockProcess.terminate).toHaveBeenCalled();

      // Then delete session
      expect(mockSessionManager.deleteSession).toHaveBeenCalledWith(
        "old-session-id",
        true,
      );

      // Then create new session
      expect(mockSessionManager.createSession).toHaveBeenCalledWith(
        "team-iris",
        "team-alpha",
      );
    });

    it("should continue with cleanup even if process termination fails", async () => {
      // Make termination fail
      vi.mocked(mockProcess.terminate).mockRejectedValue(
        new Error("Termination failed"),
      );

      const result = await reboot(
        { fromTeam: "team-iris", toTeam: "team-alpha" },
        mockIris,
        mockSessionManager,
        mockProcessPool,
      );

      // Should still complete the operation
      expect(result).toMatchObject({
        from: "team-iris",
        to: "team-alpha",
        hadPreviousSession: true,
        oldSessionId: "old-session-id",
        newSessionId: "new-session-id",
        processTerminated: false, // Failed to terminate
      });

      // Should still delete session and create new one
      expect(mockSessionManager.deleteSession).toHaveBeenCalled();
      expect(mockSessionManager.createSession).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      vi.mocked(mockSessionManager.getSession).mockReturnValue({
        sessionId: "old-session-id",
        fromTeam: "team-iris",
        toTeam: "team-alpha",
        status: "active",
        createdAt: new Date(),
        lastUsedAt: new Date(),
        messageCount: 5,
      });

      vi.mocked(mockProcessPool.getProcessBySessionId).mockReturnValue(
        undefined,
      );
    });

    it("should throw error if session deletion fails", async () => {
      vi.mocked(mockSessionManager.deleteSession).mockRejectedValue(
        new Error("Database error"),
      );

      await expect(
        reboot(
          { fromTeam: "team-iris", toTeam: "team-alpha" },
          mockIris,
          mockSessionManager,
          mockProcessPool,
        ),
      ).rejects.toThrow("Database error");

      // Should not create new session if deletion failed
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });
  });

  describe("message cache handling", () => {
    beforeEach(() => {
      vi.mocked(mockSessionManager.getSession).mockReturnValue({
        sessionId: "old-session-id",
        fromTeam: "team-iris",
        toTeam: "team-alpha",
        status: "active",
        createdAt: new Date(),
        lastUsedAt: new Date(),
        messageCount: 3,
      });

      vi.mocked(mockProcessPool.getProcessBySessionId).mockReturnValue(
        undefined,
      );

      vi.mocked(mockSessionManager.deleteSession).mockResolvedValue(undefined);
      vi.mocked(mockSessionManager.createSession).mockResolvedValue({
        sessionId: "new-session-id",
        fromTeam: "team-iris",
        toTeam: "team-alpha",
        status: "active",
        createdAt: new Date(),
        lastUsedAt: new Date(),
        messageCount: 0,
      });
    });

    it("should check for message cache existence", async () => {
      vi.mocked(mockIris.getMessageCache).mockReturnValue({
        sessionId: "old-session-id",
      } as any);

      await reboot(
        { fromTeam: "team-iris", toTeam: "team-alpha" },
        mockIris,
        mockSessionManager,
        mockProcessPool,
      );

      // Should check for message cache
      expect(mockIris.getMessageCache).toHaveBeenCalledWith("old-session-id");
    });

    it("should handle missing message cache gracefully", async () => {
      vi.mocked(mockIris.getMessageCache).mockReturnValue(null);

      const result = await reboot(
        { fromTeam: "team-iris", toTeam: "team-alpha" },
        mockIris,
        mockSessionManager,
        mockProcessPool,
      );

      expect(result.newSessionId).toBe("new-session-id");
    });
  });
});
