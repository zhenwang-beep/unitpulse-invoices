import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Deliberately separate from vite.config.ts: the app config loads the React and
 * Tailwind plugins, which the suite has no use for. Only the `@` alias is
 * carried over so test files can import the same way the app does.
 *
 * Scope: pure logic only. There is no jsdom environment here because nothing in
 * this suite touches the DOM, the network or the database.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
