import { defineConfig, PluginOption } from "vite"
import { solidStart } from "@solidjs/start/config"
import { nitro } from "nitro/vite"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [tailwindcss(), solidStart() as PluginOption, nitro()],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
})
