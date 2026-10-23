import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"

// Content scripts are classic scripts and cannot import modules, so the page-status script builds on its
// own as a single IIFE next to the main build's output.
export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome130",
    minify: mode !== "development",
    sourcemap: mode === "development" ? "inline" : false,
    lib: {
      entry: fileURLToPath(new URL("./src/content/page-status.ts", import.meta.url)),
      formats: ["iife"],
      name: "opencodeBrowserPageStatus",
      fileName: () => "content.js",
    },
  },
}))
