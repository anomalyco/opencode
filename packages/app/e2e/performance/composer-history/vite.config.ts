import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import app from "../../../vite"

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
  plugins: [app],
  build: { target: "esnext", outDir: process.env.OPENCODE_HISTORY_BUILD, emptyOutDir: true },
})
