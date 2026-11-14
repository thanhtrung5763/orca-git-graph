import path from "node:path";

import { defineConfig } from "vitest/config";

const alias = [
  { find: /^@\//, replacement: path.resolve(__dirname, "src") + "/" },
  { find: /^@tests\//, replacement: path.resolve(__dirname, "tests") + "/" }
];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "backend",
          include: ["tests/backend/**/*.test.ts"]
        }
      },
      {
        resolve: { alias },
        test: {
          name: "orca",
          include: ["tests/orca/**/*.test.ts"]
        }
      },
      {
        resolve: { alias },
        test: {
          name: "webview",
          include: ["tests/webview/**/*.test.ts"],
          setupFiles: ["tests/webview/setup.ts"]
        }
      }
    ]
  }
});
