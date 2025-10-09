/**
 * Iris MCP - Claude Process Wrapper
 * Manages a single Claude Code process with stdio communication
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import type { ProcessMessage, ProcessStatus, ProcessMetrics, TeamConfig } from './types.js';
import { Logger } from '../utils/logger.js';
import { ProcessError, TimeoutError } from '../utils/errors.js';

export class ClaudeProcess extends EventEmitter {
  private process: ChildProcess | null = null;
  private status: ProcessStatus = 'stopped';
  private messageQueue: ProcessMessage[] = [];
  private currentMessage: ProcessMessage | null = null;
  private responseBuffer: string = '';

  private messagesProcessed = 0;
  private startTime = 0;
  private logger: Logger;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(
    private teamName: string,
    private teamConfig: TeamConfig,
    private idleTimeout: number
  ) {
    super();
    this.logger = new Logger(`process:${teamName}`);
  }

  /**
   * Spawn the Claude Code process
   */
  async spawn(): Promise<void> {
    if (this.process) {
      throw new ProcessError('Process already running', this.teamName);
    }

    this.status = 'spawning';
    this.startTime = Date.now();

    try {
      this.logger.info('Spawning Claude Code process', {
        path: this.teamConfig.path,
        skipPermissions: this.teamConfig.skipPermissions,
      });

      // Spawn claude-code CLI
      // TODO: Adjust command based on actual claude-code installation
      const args = ['--headless'];

      if (this.teamConfig.skipPermissions) {
        args.push('--skip-permissions');
      }

      this.process = spawn('claude-code', args, {
        cwd: this.teamConfig.path,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CLAUDE_HEADLESS: '1',
        },
      });

      // Handle process events
      this.process.on('error', (error) => {
        this.logger.error('Process error', error);
        this.handleProcessError(error);
      });

      this.process.on('exit', (code, signal) => {
        this.logger.info('Process exited', { code, signal });
        this.handleProcessExit(code, signal);
      });

      // Handle stdout (responses from Claude)
      if (this.process.stdout) {
        this.process.stdout.on('data', (data) => {
          this.handleStdout(data);
        });
      }

      // Handle stderr (logs from Claude)
      if (this.process.stderr) {
        this.process.stderr.on('data', (data) => {
          this.logger.debug('Claude stderr', { output: data.toString() });
        });
      }

      // Wait for process to be ready
      await this.waitForReady();

      this.status = 'idle';
      this.resetIdleTimer();

      this.logger.info('Process spawned successfully', {
        pid: this.process.pid,
      });

      this.emit('spawned', { teamName: this.teamName, pid: this.process.pid });
    } catch (error) {
      this.status = 'stopped';
      throw new ProcessError(
        `Failed to spawn process: ${error instanceof Error ? error.message : error}`,
        this.teamName
      );
    }
  }

  /**
   * Send a message to the Claude Code process
   */
  async sendMessage(message: string, timeout = 30000): Promise<string> {
    if (!this.process || this.status === 'stopped') {
      throw new ProcessError('Process not running', this.teamName);
    }

    return new Promise((resolve, reject) => {
      const messageObj: ProcessMessage = { message, resolve, reject };

      this.messageQueue.push(messageObj);
      this.processNextMessage();

      // Timeout handling
      const timeoutId = setTimeout(() => {
        if (this.currentMessage === messageObj) {
          this.currentMessage = null;
          reject(new TimeoutError('Message send', timeout));
          this.processNextMessage();
        } else {
          const index = this.messageQueue.indexOf(messageObj);
          if (index > -1) {
            this.messageQueue.splice(index, 1);
            reject(new TimeoutError('Message queued', timeout));
          }
        }
      }, timeout);

      // Clear timeout on resolution
      const originalResolve = messageObj.resolve;
      const originalReject = messageObj.reject;

      messageObj.resolve = (value: any) => {
        clearTimeout(timeoutId);
        originalResolve(value);
      };

      messageObj.reject = (error: Error) => {
        clearTimeout(timeoutId);
        originalReject(error);
      };
    });
  }

  /**
   * Terminate the process gracefully
   */
  async terminate(): Promise<void> {
    if (!this.process) {
      return;
    }

    this.status = 'terminating';
    this.clearIdleTimer();

    this.logger.info('Terminating process');

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const cleanup = () => {
        this.process = null;
        this.status = 'stopped';
        this.emit('terminated', { teamName: this.teamName });
        resolve();
      };

      // Force kill after 5 seconds
      const killTimer = setTimeout(() => {
        if (this.process) {
          this.logger.warn('Force killing process');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process.once('exit', () => {
        clearTimeout(killTimer);
        cleanup();
      });

      // Try graceful shutdown first
      this.process.kill('SIGTERM');
    });
  }

  /**
   * Get process metrics
   */
  getMetrics(): ProcessMetrics {
    const now = Date.now();
    return {
      pid: this.process?.pid,
      status: this.status,
      messagesProcessed: this.messagesProcessed,
      lastUsed: now,
      uptime: this.startTime ? now - this.startTime : 0,
      idleTimeRemaining: this.idleTimer ? this.idleTimeout : 0,
      queueLength: this.messageQueue.length,
    };
  }

  /**
   * Process the next message in the queue
   */
  private processNextMessage(): void {
    if (this.currentMessage || this.messageQueue.length === 0) {
      return;
    }

    if (!this.process || !this.process.stdin) {
      // Reject all queued messages
      while (this.messageQueue.length > 0) {
        const msg = this.messageQueue.shift()!;
        msg.reject(new ProcessError('Process stdin not available', this.teamName));
      }
      return;
    }

    this.currentMessage = this.messageQueue.shift()!;
    this.status = 'processing';
    this.resetIdleTimer();

    try {
      // Write message to Claude's stdin
      this.process.stdin.write(this.currentMessage.message + '\n');
      this.messagesProcessed++;

      this.emit('message-sent', {
        teamName: this.teamName,
        message: this.currentMessage.message,
      });
    } catch (error) {
      this.currentMessage.reject(
        new ProcessError(
          `Failed to write to stdin: ${error instanceof Error ? error.message : error}`,
          this.teamName
        )
      );
      this.currentMessage = null;
      this.status = 'idle';
      this.processNextMessage();
    }
  }

  /**
   * Handle stdout data from Claude
   */
  private handleStdout(data: Buffer): void {
    this.responseBuffer += data.toString();

    // Check for complete response (assuming newline-delimited)
    const lines = this.responseBuffer.split('\n');

    // Keep the last incomplete line in buffer
    this.responseBuffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim() && this.currentMessage) {
        // Resolve the current message with the response
        this.currentMessage.resolve(line);

        this.emit('message-response', {
          teamName: this.teamName,
          response: line,
        });

        this.currentMessage = null;
        this.status = 'idle';

        // Process next message if any
        this.processNextMessage();
      }
    }
  }

  /**
   * Handle process errors
   */
  private handleProcessError(error: Error): void {
    this.logger.error('Process error', error);

    // Reject current and queued messages
    if (this.currentMessage) {
      this.currentMessage.reject(new ProcessError(error.message, this.teamName));
      this.currentMessage = null;
    }

    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      msg.reject(new ProcessError('Process crashed', this.teamName));
    }

    this.emit('error', { teamName: this.teamName, error });
  }

  /**
   * Handle process exit
   */
  private handleProcessExit(code: number | null, signal: string | null): void {
    this.status = 'stopped';
    this.process = null;
    this.clearIdleTimer();

    // Reject any pending messages
    if (this.currentMessage) {
      this.currentMessage.reject(new ProcessError('Process exited', this.teamName));
      this.currentMessage = null;
    }

    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift()!;
      msg.reject(new ProcessError('Process exited', this.teamName));
    }

    this.emit('exited', { teamName: this.teamName, code, signal });
  }

  /**
   * Wait for process to be ready
   */
  private async waitForReady(timeout = 10000): Promise<void> {
    // For now, just wait a short time
    // TODO: Implement proper ready check based on Claude Code's output
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve();
      }, 1000);

      this.process?.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  /**
   * Reset idle timeout timer
   */
  private resetIdleTimer(): void {
    this.clearIdleTimer();

    this.idleTimer = setTimeout(() => {
      this.logger.info('Process idle timeout reached, terminating');
      this.terminate();
    }, this.idleTimeout);
  }

  /**
   * Clear idle timeout timer
   */
  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
