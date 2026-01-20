import solidPlugin from "vite-plugin-solid"
import tailwindcss from "@tailwindcss/vite"
import { fileURLToPath } from "url"
import fs from "fs"
import path from "path"

/**
 * @type {import("vite").PluginOption}
 */
export default [
  {
    name: "opencode-desktop:config",
    config() {
      return {
        resolve: {
          alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
          },
        },
        worker: {
          format: "es",
        },
      }
    },
  },
  {
    name: "spa-fallback",
    configureServer(server) {
      // Return a function to run after other middlewares
      return () => {
        server.middlewares.use((req, res, next) => {
          // Skip if it's a file request or special Vite paths
          if (
            req.url.match(/\.\w+(\?.*)?$/) ||
            req.url.startsWith("/@") ||
            req.url.startsWith("/node_modules") ||
            req.url.startsWith("/src")
          ) {
            return next()
          }
          // Serve index.html for SPA routes
          const indexPath = path.join(fileURLToPath(new URL(".", import.meta.url)), "index.html")
          res.setHeader("Content-Type", "text/html")
          fs.createReadStream(indexPath).pipe(res)
        })
      }
    },
  },
  tailwindcss(),
  solidPlugin(),
]
