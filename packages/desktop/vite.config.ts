import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin, tailwindcss(), solidPlugin()] as any,
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: 3000,
  },
  build: {
    target: "esnext",
  },
})
