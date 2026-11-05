// Uploads the heavy media in public/ (src/lib/media.ts `mediaFile`) to the opencode.ai files bucket
// (served at https://opencode.ai/files/), at the same path under the version prefix site/2026-11,
// and writes media-manifest.txt. Not part of the build. See MEDIA.md.
//
//   bun ./script/upload-media.ts --manifest         rewrite media-manifest.txt from public/
//   bun ./script/upload-media.ts                    print the uploads (dry run)
//   MEDIA_BUCKET=<files bucket> bun ./script/upload-media.ts --run    upload with `wrangler r2 object put`
//
// MEDIA_PREFIX (default site/2026-11) must match mediaBase in src/lib/media.ts. Uploads only the files
// media-manifest.txt lists (what the site uses); files that git tracks stay in the static assets.
import { createHash } from "node:crypto"
import path from "node:path"
import { Glob } from "bun"
import { mediaFile } from "../src/lib/media"

const root = path.resolve(import.meta.dir, "..")
const publicDir = path.join(root, "public")
const bucket = process.env.MEDIA_BUCKET ?? "<files bucket>"
const prefix = process.env.MEDIA_PREFIX ?? "site/2026-11"
const run = process.argv.includes("--run")
const writeManifest = process.argv.includes("--manifest")

const tracked = new Set(
  (await Bun.$`git ls-files public`.cwd(root).quiet().text()).split("\n").map((file) => file.replace(/^public\//, "")),
)
const files = (await Array.fromAsync(new Glob("**/*").scan({ cwd: publicDir })))
  .filter((file) => mediaFile.test(file) && !tracked.has(file))
  .sort()

const types: Record<string, string> = {
  mp4: "video/mp4",
  webm: "audio/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  zip: "application/zip",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
}

if (writeManifest) {
  const lines = await Promise.all(
    files.map(async (file) => {
      const bytes = await Bun.file(path.join(publicDir, file)).arrayBuffer()
      return `${createHash("sha256").update(new Uint8Array(bytes)).digest("hex")}  ${bytes.byteLength}  /${file}`
    }),
  )
  await Bun.write(
    path.join(root, "media-manifest.txt"),
    `# sha256  bytes  path: the files the site requests, uploaded to https://opencode.ai/files/${prefix}/<path>\n${lines.join("\n")}\n`,
  )
  console.log(`media-manifest.txt: ${files.length} files; remove the ones the site does not request (MEDIA.md)`)
  process.exit(0)
}

// Upload only what media-manifest.txt lists: the files the site requests.
const listed = (await Bun.file(path.join(root, "media-manifest.txt")).text())
  .split("\n")
  .filter((line) => line && !line.startsWith("#"))
  .map((line) => line.split(/\s+/)[2].slice(1))
for (const file of listed) {
  const key = `${bucket}/${prefix}/${file}`
  const type = types[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream"
  if (!run) {
    console.log(`would upload ${key} (${type})`)
    continue
  }
  await Bun.$`bunx wrangler r2 object put ${key} --file ${path.join(publicDir, file)} --content-type ${type} --cache-control ${"public, max-age=31536000, immutable"} --remote`.cwd(
    root,
  )
}
console.log(`${run ? "uploaded" : "dry run:"} ${listed.length} files to ${bucket}/${prefix}`)
