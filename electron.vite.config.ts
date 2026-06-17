import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          {
            src: resolve(__dirname, "node_modules/onnxruntime-web/dist/*.wasm"),
            dest: "ort",
          },
          {
            src: resolve(__dirname, "node_modules/onnxruntime-web/dist/*.mjs"),
            dest: "ort",
          },
        ],
      }),
    ],
    // onnxruntime-web loads its wasm/.mjs glue dynamically at runtime; Vite's
    // dep pre-bundling rewrites those paths into .vite/deps and breaks the load.
    // Excluding it keeps the package's own relative resolution intact.
    optimizeDeps: {
      exclude: ["onnxruntime-web"],
    },
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
