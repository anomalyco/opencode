import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

// The Cloudflare plugin shapes the Worker and public/ into Build Output for `cf deploy --prebuilt`.
export default defineConfig({
  plugins: [cloudflare()],
})
