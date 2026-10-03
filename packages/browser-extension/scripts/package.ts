// Builds the extension and zips it for the Chrome Web Store: release/opencode-browser-<version>.zip.
// The store assigns its own ID and rejects the `key` field, which only pins the ID of unpacked builds.
import { $ } from "bun"
import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const staging = path.join(root, "release", "staging")
await $`bun run build`.cwd(root)
await rm(staging, { recursive: true, force: true })
await mkdir(staging, { recursive: true })
await cp(path.join(root, "dist"), staging, { recursive: true })
const manifest = await Bun.file(path.join(staging, "manifest.json")).json()
delete manifest.key
await Bun.write(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
const zip = path.join(root, "release", `opencode-browser-${manifest.version}.zip`)
await rm(zip, { force: true })
await $`zip -qrX ${zip} . -x "*.map" -x ".DS_Store"`.cwd(staging)
await rm(staging, { recursive: true, force: true })
console.log(zip)
