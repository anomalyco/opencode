import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import path from "path"

export default defineConfig({
  plugins: [solid()],
  base: "./", // Use relative paths for Electron compatibility
  resolve: {
    conditions: ["browser", "import", "module", "default"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@opencode-ai/sdk/server": path.resolve(__dirname, "./src/server-stub.ts"),
    },
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
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
      external: [],
    },
  },
})
