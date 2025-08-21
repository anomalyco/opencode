import { defineConfig } from "vite"
import solidPlugin from "vite-plugin-solid"
import pages from "vite-plugin-pages"
import fs from "fs"
import path from "path"
import { generateHydrationScript, getAssets } from "solid-js/web"

export default defineConfig({
  plugins: [
    pages({
      exclude: ["**/~*", "**/components/*"],
    }),
    solidPlugin({ ssr: true }),
    {
      name: "vite-plugin-solid-ssr-render",
      apply: (config, env) => {
        return env.command === "build" && !config.build?.ssr
      },
      closeBundle: async () => {
        console.log("Pre-rendering pages...")
        const dist = path.resolve("dist")
        try {
          const serverEntryPath = path.join(dist, "server/entry-server.js")
          const serverEntry = await import(serverEntryPath + "?t=" + Date.now())

          const template = fs.readFileSync(
            path.join(dist, "client/index.html"),
            "utf-8",
          )
          fs.writeFileSync(path.join(dist, "client/fallback.html"), template)

          const routes = ["/"]
          for (const route of routes) {
            const { app } = await serverEntry.render({ url: route })
            const html = template
              .replace("<!--ssr-outlet-->", app)
              .replace("<!--ssr-head-->", generateHydrationScript())
              .replace("<!--ssr-assets-->", getAssets())
            const filePath = path.join(
              dist,
              `client${route === "/" ? "/index" : route}.html`,
            )
            fs.mkdirSync(path.dirname(filePath), {
              recursive: true,
            })
            fs.writeFileSync(filePath, html)

            console.log(`Pre-rendered: ${filePath}`)
          }
        } catch (error) {
          console.error("Error during pre-rendering:", error)
        }
      },
    },
  ],
  server: {
    port: 3000,
    host: "0.0.0.0",
  },
  build: {
    target: "esnext",
  },
})
