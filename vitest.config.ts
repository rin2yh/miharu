import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/web/test/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: [
        "src/domain/**/*.ts",
        "src/shared/**/*.ts",
        "src/web/api.ts",
        "src/web/App.tsx",
        "src/web/routes/**/*.ts",
        "src/cron/**/*.ts",
      ],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**"],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
});
