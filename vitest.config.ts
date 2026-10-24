import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

const migrations = await readD1Migrations(new URL("./db/migrations", import.meta.url).pathname);

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./src/web/test/setup.ts"],
          exclude: [...configDefaults.exclude, "e2e/**", "src/shared/store.integration.test.ts"],
          restoreMocks: true,
          clearMocks: true,
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
          }),
        ],
        test: {
          name: "d1",
          include: ["src/shared/store.integration.test.ts"],
          clearMocks: true,
          restoreMocks: true,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
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
