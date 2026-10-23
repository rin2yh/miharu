import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    cloudflare({ viteEnvironment: { name: "worker" } }),
  ],
  environments: {
    worker: { build: { sourcemap: true } },
  },
});
