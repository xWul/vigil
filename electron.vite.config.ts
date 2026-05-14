import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cpSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

function copyMainPrompts(): Plugin {
  return {
    name: "copy-main-prompts",
    apply: "build",
    closeBundle() {
      cpSync(resolve("src/main/ai/prompts"), resolve("out/main/prompts"), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ include: ["typescript"] }), copyMainPrompts()],
    resolve: {
      alias: {
        "@main": resolve("src/main"),
        "@shared": resolve("src/shared"),
      },
    },
    build: {
      outDir: "out/main",
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@preload": resolve("src/preload"),
        "@shared": resolve("src/shared"),
      },
    },
    build: {
      outDir: "out/preload",
    },
  },
  renderer: {
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer"),
        "@shared": resolve("src/shared"),
      },
    },
    root: "src/renderer",
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: resolve("src/renderer/index.html"),
      },
    },
  },
});
