import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

export default defineConfig({
  root: import.meta.dirname,
  plugins: [solid()],
})
