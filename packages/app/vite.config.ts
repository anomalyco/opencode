import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import desktopPlugin, { channel } from "./vite.js"
import { icons } from "./vite.icons"
import { serviceWorker } from "./vite.pwa"

export default defineConfig({
  plugins: [desktopPlugin, icons(channel), serviceWorker(fileURLToPath(new URL("./dist", import.meta.url)))] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    ...(process.env.VITE_OPENCODE_TEST_FIXTURES === "1"
      ? {
          rolldownOptions: {
            input: [
              "index.html",
              "e2e/utils/settings-wsl.html",
              "e2e/utils/app-direction.html",
              "e2e/utils/windows-menu.html",
            ],
          },
        }
      : {}),
    assetsDir: "_assets",
    target: "esnext",
    sourcemap: true,
  },
})
