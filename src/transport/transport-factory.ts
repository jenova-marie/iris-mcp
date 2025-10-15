/**
 * Transport Factory - Selects appropriate transport based on config
 *
 * Phase 1: Only LocalTransport supported
 * Phase 2: Will add RemoteSSHTransport
 * Future: DockerTransport, KubernetesTransport, etc.
 */

import type { Transport } from './transport.interface.js';
import { LocalTransport } from './local-transport.js';
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
      logger.error(
        { teamName, remote: irisConfig.remote },
        'Remote execution not yet implemented (Phase 2)',
      );
      throw new Error(
        `Remote execution not yet implemented. Team "${teamName}" specifies remote: "${irisConfig.remote}". ` +
        'This feature will be available in Phase 2 of the remote execution implementation. ' +
        'See docs/future/REMOTE_IMPLEMENTATION_PLAN.md for details.',
      );
    }

    // Phase 1: Only LocalTransport
    logger.debug({ teamName }, 'Creating LocalTransport');
    return new LocalTransport(teamName, irisConfig, sessionId);
  }
}
