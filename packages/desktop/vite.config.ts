import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import path from "path"
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet"
import { generateThemeCSS } from "./scripts/vite-theme-plugin"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    conditions: ["solid"],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "solid-js",
  },
  plugins: [
    generateThemeCSS(),
    tailwindcss(),
    solidPlugin(),
    iconsSpritesheet({
      withTypes: true,
      inputDir: "src/assets/file-icons",
      outputDir: "src/ui/file-icons",
      formatter: "prettier",
    }),
  ],
  server: {
    host: process.env["TAURI_DEV_HOST"] || "127.0.0.1",
    port: parseInt(process.env["PORT"] || "5173"),
    strictPort: false,
    proxy: {
      '/session': 'http://127.0.0.1:4096',
      '/config': 'http://127.0.0.1:4096',
      '/agent': 'http://127.0.0.1:4096',
      '/file': 'http://127.0.0.1:4096',
      '/path': 'http://127.0.0.1:4096',
      '/event': 'http://127.0.0.1:4096',
    },
  },
  build: {
    target: "esnext",
  },
})
