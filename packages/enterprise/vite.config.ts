import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"

const nitroConfig: any = (() => {
  const target = process.env.OPENCODE_DEPLOYMENT_TARGET
  if (target === "cloudflare") {
    return {
      compatibilityDate: "2024-09-19",
      preset: "cloudflare_module",
      cloudflare: {
        nodeCompat: true,
      },
    }
  }
  return {}
})()

export default defineConfig({
  plugins: [
    tailwindcss(),
    solidStart() as PluginOption,
    nitro({
      ...nitroConfig,
      baseURL: process.env.OPENCODE_BASE_URL,
    }),
  ],
  server: {
    // FORK: R6 loopback-only — 默认 0.0.0.0 暴露 dev server 到 LAN 是安全风险 2026-05-25
    host: "127.0.0.1",
    allowedHosts: true,
  },
  worker: {
    format: "es",
  },
})
