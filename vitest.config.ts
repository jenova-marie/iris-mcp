import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    testTimeout: 20000, // 20 second global timeout for Claude CLI integration tests
    hookTimeout: 10000, // 10 second timeout for hooks (beforeEach, afterEach, etc.)
    teardownTimeout: 10000, // 10 second timeout for cleanup (process termination)
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.ts", "**/*.config.ts"],
    },
    pool: "forks", // Use forks for better isolation in integration tests
    poolOptions: {
      forks: {
        singleFork: true, // Run tests sequentially to avoid port conflicts
      },
    },
    reporters: ["default"],
    logHeapUsage: true, // Help debug memory issues
    bail: 1, // Stop after first test failure in integration tests
  },
});
