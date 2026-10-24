import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/web/test/setup.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"],
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      provider: "v8",
      include: [
        "src/domain/**/*.ts",
        "src/shared/**/*.ts",
        "src/web/**/*.ts",
        "src/web/**/*.tsx",
        "src/cron/**/*.ts",
      ],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**"],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 70,
        statements: 85,
      },
    },
  },
});
