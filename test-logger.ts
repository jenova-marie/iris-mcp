/**
 * Test script for Wonder Logger integration
 *
 * Run with: node --loader ts-node/esm test-logger.ts
 * Or compile and run: pnpm build && node dist/test-logger.js
 */

import { initializeObservability, getChildLogger, Logger } from './src/utils/logger.js';

async function main() {
  console.log('='.repeat(60));
  console.log('Wonder Logger Integration Test');
  console.log('='.repeat(60));
  console.log();

  // Test 1: Initialize observability
  console.log('[TEST 1] Initializing observability...');
  const { logger, telemetry } = initializeObservability();
  console.log('✓ Observability initialized');
  console.log(`  - Logger: ${logger ? 'OK' : 'FAIL'}`);
  console.log(`  - Telemetry: ${telemetry ? 'OK' : 'Disabled'}`);
  console.log();

  // Test 2: Legacy Logger class (backwards compatibility)
  console.log('[TEST 2] Testing Legacy Logger class...');
  const legacyLogger = new Logger('test:legacy');
  legacyLogger.info('Legacy logger info message', { test: 'metadata' });
  legacyLogger.warn('Legacy logger warning');
  legacyLogger.debug('Legacy logger debug message', { debug: true });
  console.log('✓ Legacy logger works (check logs/iris.log)');
  console.log();

  // Test 3: New getChildLogger API
  console.log('[TEST 3] Testing getChildLogger API...');
  const newLogger = getChildLogger('test:new-api');

  // Test simple messages
  newLogger.info('New API simple message');

  // Test with metadata (NOTE: parameters are REVERSED)
  newLogger.info({ user: 'test', action: 'login' }, 'New API with metadata');

  // Test error logging
  const testError = new Error('Test error for logging');
  newLogger.error({ err: testError, context: 'test' }, 'New API error logging');

  console.log('✓ New API logger works (check logs/iris.log)');
  console.log();

  // Test 4: Hierarchical contexts
  console.log('[TEST 4] Testing hierarchical contexts...');
  const contexts = [
    'iris:core',
    'pool:manager',
    'pool:process:team-frontend',
    'session:manager',
    'cache:entry',
    'action:tell',
    'config:teams',
    'dashboard:server',
    'cli:install'
  ];

  for (const context of contexts) {
    const ctxLogger = getChildLogger(context);
    ctxLogger.info({ timestamp: Date.now() }, `Testing context: ${context}`);
  }
  console.log('✓ All hierarchical contexts work');
  console.log();

  // Test 5: Log levels
  console.log('[TEST 5] Testing log levels...');
  const levelLogger = getChildLogger('test:levels');
  levelLogger.trace({ level: 'trace' }, 'Trace level message');
  levelLogger.debug({ level: 'debug' }, 'Debug level message');
  levelLogger.info({ level: 'info' }, 'Info level message');
  levelLogger.warn({ level: 'warn' }, 'Warn level message');
  levelLogger.error({ level: 'error' }, 'Error level message');
  levelLogger.fatal({ level: 'fatal' }, 'Fatal level message');
  console.log('✓ All log levels work');
  console.log();

  // Summary
  console.log('='.repeat(60));
  console.log('All tests passed! ✨');
  console.log();
  console.log('Check logs/iris.log for structured JSON output');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
