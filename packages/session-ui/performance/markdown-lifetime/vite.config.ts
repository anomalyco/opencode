import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { fileURLToPath } from "node:url"

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [solid()],
  build: { outDir: process.env.MARKDOWN_BUILD_DIR, emptyOutDir: true, sourcemap: true },
  worker: { format: "es" },
})
