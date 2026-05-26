import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import { defineConfig, type PluginOption } from "vite"

export default defineConfig({
  plugins: [
    solidStart() as PluginOption,
    nitro({
      compatibilityDate: "2024-09-19",
      preset: "cloudflare-module",
      cloudflare: {
        nodeCompat: true,
      },
    }),
  ],
  server: {
    allowedHosts: true,
  },
  build: {
    minify: false,
  },
})
