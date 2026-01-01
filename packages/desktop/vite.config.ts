import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: {
      // Proxy API calls to the opencode server during development
      "/session": "http://localhost:4096",
      "/project": "http://localhost:4096",
      "/event": "http://localhost:4096",
      "/health": "http://localhost:4096",
      "/config": "http://localhost:4096",
      "/provider": "http://localhost:4096",
      "/installation": "http://localhost:4096",
      "/file": "http://localhost:4096",
    },
  },
  build: {
    target: "esnext",
  },
})
