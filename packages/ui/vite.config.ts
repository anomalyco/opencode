import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import { iconsSpritesheet } from "vite-plugin-icons-spritesheet"

export default defineConfig({
  plugins: [
    solidPlugin(),
    iconsSpritesheet({
      withTypes: true,
      inputDir: "src/assets/file-icons",
      outputDir: "src/components/file-icons",
      formatter: "prettier",
    }),
  ],
  server: { port: 3001 },
  build: {
    target: "esnext",
  },
})
