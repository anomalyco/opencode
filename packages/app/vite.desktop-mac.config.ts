import { defineConfig } from "vite"
import appPlugin from "./vite.js"

const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "prod"
})()

export default defineConfig({
  base: "./",
  publicDir: "public",
  plugins: appPlugin,
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
