import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["spec/**/*.test.ts", "scripts/**/*.test.ts"],
    globalSetup: ["./spec/global-setup.ts"],
  },
});
