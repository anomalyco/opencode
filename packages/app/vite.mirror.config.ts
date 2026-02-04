import { defineConfig } from "vite"
import desktopPlugin from "./vite"

export default defineConfig({
  plugins: [desktopPlugin] as any,
  build: {
    target: "esnext",
    outDir: "dist-mirror",
    rollupOptions: {
      input: "mirror.html",
    },
  },
})
