import { defineConfig } from "vite"
import desktopPlugin from "./vite"

const proxyTarget = {
  target: "http://127.0.0.1:4096",
  changeOrigin: true,
}

export default defineConfig({
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    proxy: {
      "/global": proxyTarget,
      "/project": proxyTarget,
      "/pty": proxyTarget,
      "/config": proxyTarget,
      "/experimental": proxyTarget,
      "/session": proxyTarget,
      "/permission": proxyTarget,
      "/question": proxyTarget,
      "/provider": proxyTarget,
      "/mcp": proxyTarget,
      "/tui": proxyTarget,
      "/file": proxyTarget,
      "/find": proxyTarget,
      "/auth": proxyTarget,
      "/instance": proxyTarget,
      "/path": proxyTarget,
      "/vcs": proxyTarget,
      "/command": proxyTarget,
      "/log": proxyTarget,
      "/agent": proxyTarget,
      "/skill": proxyTarget,
      "/lsp": proxyTarget,
      "/formatter": proxyTarget,
      "/event": proxyTarget,
      "/doc": proxyTarget,
    },
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
