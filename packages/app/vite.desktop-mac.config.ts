import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import appPlugin from "./vite.js"

const ipcBridge = fileURLToPath(new URL("../ipc-bridge/src/index.ts", import.meta.url))

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "prod"
})()

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: appPlugin,
  resolve: {
    alias: {
      "@opencode-ai/ipc-bridge": ipcBridge,
    },
  },
  define: {
    "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
  },
  build: {
    outDir: "dist-desktop-mac",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: "desktop-mac.html",
    },
  },
})
