import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  appType: "spa",
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
    hmr: {
      // When proxied, HMR WebSocket needs to connect directly to Vite
      clientPort: 3000,
    },
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
