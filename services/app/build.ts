import { cp, mkdir, rm } from "node:fs/promises"
import config from "./cloudflare.config"

process.chdir(import.meta.dir)
await Bun.$`bun turbo build`.cwd("../../packages/app")
const out = ".cloudflare/output/v0"
const worker = `${out}/workers/default`
await rm(".cloudflare/output", { force: true, recursive: true })
await mkdir(`${worker}/bundle`, { recursive: true })
await cp("index.mjs", `${worker}/bundle/index.mjs`)
await cp("../../packages/app/dist", `${worker}/assets`, {
  recursive: true,
  filter: (file) => !file.endsWith(".map"),
})
await Bun.write(`${out}/config.json`, JSON.stringify({ accountId: config.accountId, buildContext: { isPreview: false, mode: "v1" } }))
await Bun.write(`${worker}/worker.config.json`, JSON.stringify({
  ...config.worker,
  manifest: { type: "complete", mainModule: "index.mjs", modules: { "index.mjs": { type: "esm" } } },
}))
