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
    host: "0.0.0.0",
    port: 3000,
  },
  build: {
    target: "esnext",
  },
})
