import { cp } from "node:fs/promises"
import config from "../astro.config"

const base = config.base?.replace(/\/$/, "") ?? ""
const docs = `dist/client${base}/docs`

await cp(`dist/client${base}/docs-index`, docs, { recursive: true })
await Bun.$`pagefind --site ${docs}`
