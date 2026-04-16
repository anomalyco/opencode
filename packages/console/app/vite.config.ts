import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"

export default defineConfig({
  plugins: [
    solidStart({
      middleware: "./src/middleware.ts",
    }) as PluginOption,
    nitro({
      compatibilityDate: "2024-09-19",
      preset: "cloudflare_module",
      cloudflare: {
        nodeCompat: true,
      },
    }),
  ],
  server: {
    allowedHosts: true,
  },
  resolve: {
    alias: process.env.NODE_ENV === "development"
      ? {
          "@solidjs/start/dist/shared/lazy.js": "/src/shims/solid-start-lazy.ts",
          "solid-start:get-manifest": "/src/shims/solid-start-get-manifest.ts",
        }
      : {},
  },
  worker: {
    format: "es",
  },
  build: {
    rollupOptions: {
      external: ["cloudflare:workers"],
    },
    minify: false,
  },
})
