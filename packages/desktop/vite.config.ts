import { defineConfig } from "vite"
import appPlugin from "@opencode-ai/app/vite"
import legacy from "@vitejs/plugin-legacy"

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    appPlugin,
    // Transforms ES2018+ regex features (named capture groups, lookbehinds)
    // used in shiki and other deps so the app works on macOS Monterey's
    // WKWebView (Safari 14 era JavaScriptCore) — fixes the
    // "SyntaxError: Invalid regular expression: invalid group specifier name"
    // white-screen crash reported on macOS 12.x (Intel & Apple Silicon).
    legacy({
      targets: ["safari >= 14", "ios_saf >= 14"],
      // We don't need a separate IE11-era legacy chunk in Tauri — just apply
      // the transforms to the modern bundle via modernPolyfills.
      renderLegacyChunks: false,
      modernPolyfills: true,
    }),
  ],
  publicDir: "../app/public",
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  esbuild: {
    // Improves production stack traces
    keepNames: true,
  },
  // build: {
  // sourcemap: true,
  // },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
})
