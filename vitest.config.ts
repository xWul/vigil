import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@main": resolve("src/main"),
      "@preload": resolve("src/preload"),
      "@renderer": resolve("src/renderer"),
      "@shared": resolve("src/shared"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "out", "dist", "release"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/**/index.ts",
        "src/renderer/main.tsx",
        "src/main/index.ts",
      ],
    },
  },
});
