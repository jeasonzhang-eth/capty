import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/e2e/**",
      "**/.claude/**",
    ],
    setupFiles: ["tests/renderer/setup.ts"],
    environmentMatchGlobs: [["tests/renderer/components/**", "happy-dom"]],
  },
});
