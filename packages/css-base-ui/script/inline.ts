import { rm } from "node:fs/promises"
import path from "node:path"

const root = path.join(import.meta.dir, "..", "dist")
const html = await Bun.file(path.join(root, "index.html")).text()
const script = html.match(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/)
const style = html.match(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/)

if (!script || !style) throw new Error("Vite output did not contain the expected script and stylesheet")

const javascript = (await Bun.file(path.join(root, script[1])).text()).replaceAll("</script", "<\/script")
const stylesheet = (await Bun.file(path.join(root, style[1])).text()).replaceAll("</style", "<\/style")

await Bun.write(
  path.join(root, "index.html"),
  html
    .replace(script[0], () => `<script type="module">${javascript}</script>`)
    .replace(style[0], () => `<style>${stylesheet}</style>`),
)
await rm(path.join(root, "assets"), { recursive: true })
