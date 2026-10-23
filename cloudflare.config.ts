import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig(({ isPreview }) => ({
  accountId: "3ffb9ddb43376196358f259f658b60fc",
  worker: {
    name: "miharu",
    compatibilityDate: "2026-10-19",
    entrypoint: "./src/index.ts",
    observability: {
      enabled: true,
    },
    assets: {
      notFoundHandling: "single-page-application",
      runWorkerFirst: ["/api/*"],
    },
    triggers: isPreview
      ? []
      : [
          triggers.scheduled({
            schedule: "* * * * *",
          }),
        ],
    env: {
      DB: bindings.d1({
        name: isPreview ? "miharu-status-preview" : "miharu-status",
        id: isPreview
          ? "fe57c26a-0fac-40f1-b083-7167cd2c19f4"
          : "ec29a528-708c-4ce3-8a35-f9416dacf499",
      }),
      ASSETS: bindings.assets(),
    },
  },
}));
