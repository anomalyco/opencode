import { defineConfig } from "@solidjs/start/config"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  vite: {
    plugins: [tailwindcss() as any],
    server: {
      host: "0.0.0.0",
      allowedHosts: true,
    },
  },
})
