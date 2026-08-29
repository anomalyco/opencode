import path from "node:path"
import { createServer } from "vite"
import solid from "vite-plugin-solid"

const root = path.resolve(import.meta.dir, "..")
const server = await createServer({
  root,
  configFile: false,
  resolve: { alias: { "~": path.join(root, "src") }, dedupe: ["solid-js"] },
  server: { host: "127.0.0.1", port: 3003, strictPort: true },
  plugins: [
    solid(),
    {
      name: "go-chart-preview",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== "/") return next()
          res.setHeader("Content-Type", "text/html")
          res.end(
            await server.transformIndexHtml(
              "/",
              `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Go Chart Preview</title></head><body><div id="root"></div><script type="module" src="/script/go-graph.tsx"></script></body></html>`,
            ),
          )
        })
      },
    },
  ],
})

await server.listen()
server.printUrls()
