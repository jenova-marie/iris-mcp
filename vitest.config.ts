import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    env: {
      NODE_ENV: "test",
      IRIS_HOME: resolve(__dirname, "tests"),
      IRIS_TEST_REMOTE: 1,
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
