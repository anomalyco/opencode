import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 5173,
    cors: true,
    proxy: {
      // Proxy API requests to the opencode server to avoid CORS issues
      "/global": "http://localhost:4096",
      "/session": "http://localhost:4096",
      "/message": "http://localhost:4096",
      "/project": "http://localhost:4096",
      "/provider": "http://localhost:4096",
      "/config": "http://localhost:4096",
      "/path": "http://localhost:4096",
      "/app": "http://localhost:4096",
      "/agent": "http://localhost:4096",
      "/command": "http://localhost:4096",
      "/mcp": "http://localhost:4096",
      "/lsp": "http://localhost:4096",
      "/vcs": "http://localhost:4096",
      "/permission": "http://localhost:4096",
      "/question": "http://localhost:4096",
      "/file": "http://localhost:4096",
      "/terminal": "http://localhost:4096",
      "/find": "http://localhost:4096",
      "/log": "http://localhost:4096",
    },
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
