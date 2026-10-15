import { defineConfig } from "vitest/config";

// 配布用リポジトリは core と agent-hooks だけをテストする(サーバは含めない)
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "core",
          environment: "node",
          include: ["packages/core/src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "agent-hooks",
          environment: "node",
          include: ["apps/agent-hooks/src/**/*.test.ts"],
        },
      },
    ],
  },
});
