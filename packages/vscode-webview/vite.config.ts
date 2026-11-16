import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import appPlugin from "@opencode/app/vite"

export default defineConfig(({ mode }) => ({
  plugins: [appPlugin],
  // VS Code serves the build from a resource URL it picks at runtime, so every chunk, font and worker resolves
  // relative to the module that loads it.
  base: "./",
  // The app's CSS loads its fonts from the public folder by root-relative URL, which the relative base rewrites.
  publicDir: fileURLToPath(new URL("../app/public", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("../../sdks/vscode/dist/webview", import.meta.url)),
    emptyOutDir: true,
    assetsDir: "_assets",
    target: "esnext",
    minify: mode !== "development",
    sourcemap: mode === "development",
  },
}))
