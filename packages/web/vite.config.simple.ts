import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"

export default defineConfig({
  plugins: [solidPlugin()],
  root: ".",
  build: {
    outDir: "dist/client",
  },
})
