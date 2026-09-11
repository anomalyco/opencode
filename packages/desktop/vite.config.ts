import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.ARGUS_SERVER_URL ?? "http://127.0.0.1:4096",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
})
