#!/usr/bin/env node
/**
 * Quick test to see what Claude expects for stream-json format
 */

import { spawn } from 'child_process';

const claude = spawn('claude', [
  '--print',
  '--verbose',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--dangerously-skip-permissions'
], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe']
});

console.log('Claude process started with PID:', claude.pid);

// Capture all stdout and parse JSON lines
claude.stdout.on('data', (data) => {
  const lines = data.toString().split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const json = JSON.parse(line);
      console.log('STDOUT [parsed]:', JSON.stringify(json, null, 2));

      // Check if this is a message response
      if (json.type === 'message' || json.type === 'content_block_delta') {
        console.log('*** GOT RESPONSE ***');
      }
    } catch (e) {
      console.log('STDOUT [raw]:', line);
    }
  });
});

// Capture all stderr
claude.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString());
});

// Handle process exit
claude.on('exit', (code, signal) => {
  console.log('Process exited with code:', code, 'signal:', signal);
  process.exit(code);
});

// Handle errors
claude.on('error', (error) => {
  console.error('Process error:', error);
  process.exit(1);
});

// Send a simple message after 1 second
setTimeout(() => {
  console.log('Sending message...');
  const message = JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'What is 2+2? Reply with just the number.'
        }
      ]
    }
  }) + '\n';
  console.log('Message:', message);
  claude.stdin.write(message);
}, 1000);

// Exit after 30 seconds if still running
setTimeout(() => {
  console.log('Timeout reached, killing process');
  claude.kill();
  process.exit(0);
}, 30000);
