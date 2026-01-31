import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  define: {
    "import.meta.env.VITE_BUILD_DATE": JSON.stringify(new Date().toISOString()),
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    // Proxy API requests to backend server for development
    // This avoids CORS and cookie issues with cross-origin requests
    proxy: {
      "/agent": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/command": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/global": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/project": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/session": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/provider": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/path": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/config": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/repo": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/find": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/pty": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/event": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/permission": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/question": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/mcp": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
      "/file": {
        target: "http://localhost:4096",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
