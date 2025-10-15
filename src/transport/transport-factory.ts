/**
 * Transport Factory - Selects appropriate transport based on config
 *
 * Phase 1: LocalTransport for local execution
 * Phase 2: Dual SSH implementations for remote execution (CURRENT)
 *   - SSHTransport: OpenSSH client (default)
 *   - RemoteSSH2Transport: ssh2 library (opt-in via ssh2: true)
 * Future: DockerTransport, KubernetesTransport, etc.
 */

import type { Transport } from "./transport.interface.js";
import { LocalTransport } from "./local-transport.js";
import { SSHTransport } from "./ssh-transport.js";
import { SSH2Transport } from "./ssh2-transport.js";
import type { IrisConfig } from "../process-pool/types.js";
import { getChildLogger } from "../utils/logger.js";

const logger = getChildLogger("transport:factory");

/**
 * Factory for creating appropriate Transport implementation
 */
export class TransportFactory {
  /**
   * Create transport based on configuration
   *
   * @param teamName - Name of the team
   * @param irisConfig - Team configuration (may include `remote` field)
   * @param sessionId - Session ID for Claude
   * @returns Transport instance (LocalTransport, SSHTransport, or RemoteSSH2Transport)
   */
  static create(
    teamName: string,
    irisConfig: IrisConfig,
    sessionId: string,
  ): Transport {
    // Phase 2: Check for remote execution
    if (irisConfig.remote) {
      // Dual SSH implementation strategy:
      // - Default: Use OpenSSH client (leverages ~/.ssh/config, SSH agent, ProxyJump)
      // - Opt-in: Use ssh2 library (pure JS, requires passphrase for encrypted keys)
      if (irisConfig.ssh2) {
        logger.info(
          { teamName, remote: irisConfig.remote },
          "Creating RemoteSSH2Transport (ssh2 library) for remote execution",
        );
        return new SSH2Transport(teamName, irisConfig, sessionId);
      } else {
        logger.info(
          { teamName, remote: irisConfig.remote },
          "Creating SSHTransport (OpenSSH client) for remote execution",
        );
        return new SSHTransport(teamName, irisConfig, sessionId);
      }
    }

    // Phase 1: LocalTransport for local execution
    logger.debug({ teamName }, "Creating LocalTransport");
    return new LocalTransport(teamName, irisConfig, sessionId);
  }
}
