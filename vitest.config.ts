import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Network E2E enabled: starts real runtime HTTP/WS server on dedicated ports during tests.
    include: [
      // top-level files
      "tests/unit/*.test.ts",
      "tests/integration/*.test.ts",
      "tests/e2e/*.test.ts",
      // nested files
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
      // package-local tests
      "packages/*/tests/**/*.test.ts",
    ],
    environment: "node",
    reporters: ["default"],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.d.ts",
        "**/tests/**",
        "**/examples/**",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        branches: 80,
        functions: 80,
      },
    },
  },
});
