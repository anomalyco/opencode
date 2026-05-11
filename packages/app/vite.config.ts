import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  base: "./",
  plugins: [desktopPlugin] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3001,
  },
  build: {
    target: "esnext",
    // sourcemap: true,
  },
})
