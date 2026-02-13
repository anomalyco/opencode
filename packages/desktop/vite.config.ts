import { defineConfig } from "vite"
import appPlugin from "@opencode-ai/app/vite"

const host = process.env.TAURI_DEV_HOST
const raw = Number(process.env.OPENCODE_DESKTOP_PORT ?? "1420")
const port = Number.isFinite(raw) ? raw : 1420
const hmr = host
  ? {
      protocol: "ws",
      host,
      port: port + 1,
    }
  : undefined

// https://vite.dev/config/
export default defineConfig({
  plugins: [appPlugin],
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
    port,
    strictPort: true,
    // Default to ipv4 loopback to avoid "localhost" ipv4/ipv6 resolution differences across runtimes.
    host: host ?? "127.0.0.1",
    hmr,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
})
