import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations(new URL("./db/migrations", import.meta.url).pathname);

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
    }),
  ],
  test: {
    include: ["integration-tests/**/*.test.ts"],
    clearMocks: true,
    restoreMocks: true,
  },
});
