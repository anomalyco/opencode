import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import path from "path"

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  optimizeDeps: {
    // Exclude server-only modules from pre-bundling
    exclude: ["@opencode-ai/sdk/server"],
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: "http://localhost:4096",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: {
      external: ["node:child_process", "node:process", "node:fs", "node:path", "node:events"],
    },
  },
})
