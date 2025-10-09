/**
 * Debug script to test Claude CLI communication directly
 * This helps isolate issues with the ClaudeProcess implementation
 */

import { spawn, ChildProcess } from "child_process";
import { ClaudeProcess } from "../../src/process-pool/claude-process.js";
import type { TeamConfig } from "../../src/process-pool/types.js";

async function testClaudeDirectSpawn() {
  console.log("=== Testing Direct Claude CLI Spawn ===");

  const args = [
    "--print",
    "--verbose",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--dangerously-skip-permissions"
  ];

  console.log(`Spawning: claude ${args.join(" ")}`);

  const process = spawn("claude", args, {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
    },
  });

  let responseBuffer = "";
  let initReceived = false;
  let sessionId = "";

  // Handle stdout
  process.stdout?.on("data", (data) => {
    const rawData = data.toString();
    console.log(`STDOUT (${rawData.length} bytes):`, rawData.substring(0, 500));

    responseBuffer += rawData;
    const lines = responseBuffer.split("\n");
    responseBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line);
        console.log(`PARSED MESSAGE:`, {
          type: msg.type,
          subtype: msg.subtype,
          hasEvent: !!msg.event,
          eventType: msg.event?.type,
          sessionId: msg.session_id?.substring(0, 8) + "..."
        });

        if (msg.type === "system" && msg.subtype === "init") {
          initReceived = true;
          sessionId = msg.session_id;
          console.log("✅ Init message received!");

          // Send a test message after init
          setTimeout(() => {
            sendTestMessage(process);
          }, 1000);
        }

      } catch (error) {
        console.log(`Failed to parse JSON: ${line.substring(0, 100)}`);
      }
    }
  });

  // Handle stderr
  process.stderr?.on("data", (data) => {
    console.log(`STDERR:`, data.toString());
  });

  // Handle process events
  process.on("error", (error) => {
    console.log(`PROCESS ERROR:`, error);
  });

  process.on("exit", (code, signal) => {
    console.log(`PROCESS EXITED: code=${code}, signal=${signal}`);
  });

  // Wait for init or timeout
  const initTimeout = setTimeout(() => {
    if (!initReceived) {
      console.log("❌ No init message received within 20 seconds");
      process.kill();
    }
  }, 20000);

  function sendTestMessage(proc: ChildProcess) {
    console.log("=== Sending test message ===");

    const userMessage = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Hello, Claude! Please respond with just 'Hello back!'"
          }
        ]
      }
    }) + "\n";

    console.log("Sending:", userMessage.substring(0, 200));
    proc.stdin?.write(userMessage);
  }

  // Keep process alive for testing
  await new Promise((resolve) => {
    setTimeout(() => {
      clearTimeout(initTimeout);
      process.kill();
      resolve(void 0);
    }, 45000); // 45 second timeout
  });
}

async function testClaudeProcessWrapper() {
  console.log("\n=== Testing ClaudeProcess Wrapper ===");

  const testConfig: TeamConfig = {
    path: process.cwd(),
    description: "Debug test",
    skipPermissions: true,
  };

  const claudeProcess = new ClaudeProcess("debug-test", testConfig, 300000);

  // Add event listeners for debugging
  claudeProcess.on("spawned", (data) => {
    console.log("✅ Process spawned:", data);
  });

  claudeProcess.on("error", (data) => {
    console.log("❌ Process error:", data);
  });

  claudeProcess.on("message-sent", (data) => {
    console.log("📤 Message sent:", data.message.substring(0, 100));
  });

  claudeProcess.on("message-response", (data) => {
    console.log("📥 Message response:", data.response.substring(0, 100));
  });

  try {
    console.log("Spawning ClaudeProcess...");
    await claudeProcess.spawn();

    console.log("Process metrics after spawn:", claudeProcess.getMetrics());

    console.log("Sending test message...");
    const response = await claudeProcess.sendMessage(
      "Hello, Claude! Please respond with just 'Hello back!'",
      30000
    );

    console.log("✅ Response received:", response.substring(0, 200));

  } catch (error) {
    console.log("❌ Error during ClaudeProcess test:", error);
  } finally {
    console.log("Terminating process...");
    await claudeProcess.terminate();
    console.log("Process terminated");
  }
}

async function main() {
  console.log("Claude Debug Test Script");
  console.log("========================");

  try {
    // Test 1: Direct spawn
    await testClaudeDirectSpawn();

    // Wait a bit between tests
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 2: ClaudeProcess wrapper
    await testClaudeProcessWrapper();

  } catch (error) {
    console.error("Unhandled error:", error);
  }

  console.log("\n=== Debug test complete ===");
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { testClaudeDirectSpawn, testClaudeProcessWrapper };
