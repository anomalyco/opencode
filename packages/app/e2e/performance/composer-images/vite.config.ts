import { defineConfig } from "vite"
import { fileURLToPath } from "node:url"
import app from "../../../vite"

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  publicDir: fileURLToPath(new URL("../../../public", import.meta.url)),
  plugins: [
    process.env.OPENCODE_IMAGE_PREVIEW === "off" && {
      name: "benchmark-without-image-preview",
      enforce: "pre" as const,
      transform(code: string, id: string) {
        if (!id.replaceAll("\\", "/").endsWith("/composer/editor/editor.tsx")) return

        if (!code.includes('src={url() ?? ""}')) throw new Error("Preview ablation source changed")

        return code.replace('src={url() ?? ""}', "src={undefined}")
      },
    },
    app,
  ],
  build: { target: "esnext", outDir: process.env.OPENCODE_IMAGE_BUILD, emptyOutDir: true },
})
