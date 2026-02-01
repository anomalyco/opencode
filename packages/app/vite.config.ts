import { defineConfig } from "vite"
import { execSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import desktopPlugin from "./vite"

const gitSha = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
})()

export default defineConfig({
  plugins: [desktopPlugin] as any,
  define: {
    "import.meta.env.VITE_BUILD_DATE": JSON.stringify(new Date().toISOString()),
    "import.meta.env.VITE_BUILD_SHA": JSON.stringify(gitSha),
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
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        login: fileURLToPath(new URL("./login.html", import.meta.url)),
        twoFactor: fileURLToPath(new URL("./2fa.html", import.meta.url)),
        twoFactorSetup: fileURLToPath(new URL("./2fa-setup.html", import.meta.url)),
      },
    },
    // sourcemap: true,
  },
})
