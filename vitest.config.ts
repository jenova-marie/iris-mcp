import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    env: {
      NODE_ENV: "test",
    },
    testTimeout: 30000, // 20 seconds default (enough for single Claude spawn + response)
    hookTimeout: 15000, // 15 seconds for beforeEach/afterEach (session manager init)
    teardownTimeout: 10000, // 10 seconds for cleanup (process termination)
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
