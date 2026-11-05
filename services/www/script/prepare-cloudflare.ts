import { rm } from "node:fs/promises"
import path from "node:path"
import astro from "../astro.config"

const base = astro.base?.replace(/\/$/, "") ?? ""
const snapshots = `dist/client${base}/docs-index`

await Promise.all(
  (await Array.fromAsync(new Bun.Glob("**/*.html").scan({ cwd: snapshots }))).map((file) =>
    rm(path.join(`dist/client${base}/docs`, file)),
  ),
)
await rm(snapshots, { recursive: true })
