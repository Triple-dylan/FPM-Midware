import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "integration",
    environment: "node",
    include: ["integration/**/*.integration.test.ts"],
    exclude: ["node_modules/**"],
    fileParallelism: false,
    poolOptions: { threads: { singleThread: true } },
  },
});
