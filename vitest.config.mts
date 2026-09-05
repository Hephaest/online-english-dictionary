import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The @raycast/api package ships types only; its runtime lives inside the Raycast app.
    alias: { "@raycast/api": fileURLToPath(new URL("./tests/stubs/raycast-api.ts", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
