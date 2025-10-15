/**
 * Transport Factory - Selects appropriate transport based on config
 *
 * Phase 1: LocalTransport for local execution
 * Phase 2: RemoteSSHTransport for SSH execution (CURRENT)
 * Future: DockerTransport, KubernetesTransport, etc.
 */

import type { Transport } from './transport.interface.js';
import { LocalTransport } from './local-transport.js';
import { RemoteSSHTransport } from './remote-ssh-transport.js';
import type { IrisConfig } from '../process-pool/types.js';
import { getChildLogger } from '../utils/logger.js';

const logger = getChildLogger('transport:factory');

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
   * @returns Transport instance (LocalTransport or RemoteSSHTransport)
   */
  static create(
    teamName: string,
    irisConfig: IrisConfig,
    sessionId: string,
  ): Transport {
    // Phase 2: Check for remote execution
    if (irisConfig.remote) {
      logger.info(
        { teamName, remote: irisConfig.remote },
        'Creating RemoteSSHTransport for remote execution',
      );
      return new RemoteSSHTransport(teamName, irisConfig, sessionId);
    }

    // Phase 1: LocalTransport for local execution
    logger.debug({ teamName }, 'Creating LocalTransport');
    return new LocalTransport(teamName, irisConfig, sessionId);
  }
}
