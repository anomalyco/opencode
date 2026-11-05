// Uploads the heavy media in public/ (src/lib/media.ts `mediaFile`) to the existing files bucket,
// which the /files route serves (services/files), under site/2026-11 at the same path, and writes
// media-manifest.txt. Not part of the build.
//
//   bun ./script/upload-media.ts --manifest            rewrite media-manifest.txt from public/
//   bun ./script/upload-media.ts [--mode dev]          print the uploads (dry run)
//   bun ./script/upload-media.ts [--mode dev] --run    upload with `cf r2 objects put`
//
// `--mode dev` targets opencode-dev-files (dev.opencode.ai/files); any other mode targets
// opencode-production-files (opencode.ai/files). The prefix must match mediaBase in src/lib/media.ts.
import { createHash } from "node:crypto"
import path from "node:path"
import { Glob } from "bun"
import { mediaBase, mediaFile } from "../src/lib/media"

const root = path.resolve(import.meta.dir, "..")
const publicDir = path.join(root, "public")
const mode = process.argv[process.argv.indexOf("--mode") + 1]
const bucket = process.argv.includes("--mode") && mode === "dev" ? "opencode-dev-files" : "opencode-production-files"
const prefix = mediaBase.replace(/^\/files\//, "")
const run = process.argv.includes("--run")
const writeManifest = process.argv.includes("--manifest")

const files = (await Array.fromAsync(new Glob("**/*").scan({ cwd: publicDir })))
  .filter((file) => mediaFile.test(file))
  .sort()

const types: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
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
    `# sha256  bytes  path: the files script/upload-media.ts uploads to <files bucket>/${prefix}\n${lines.join("\n")}\n`,
  )
  console.log(`media-manifest.txt: ${files.length} files`)
  process.exit(0)
}

for (const file of files) {
  const key = `${prefix}/${file}`
  const type = types[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream"
  if (!run) {
    console.log(`would upload ${bucket}/${key} (${type})`)
    continue
  }
  await Bun.$`cf r2 objects put ${key} --bucket-name ${bucket} --file ${path.join(publicDir, file)} --content-type ${type}`.cwd(
    root,
  )
}
console.log(`${run ? "uploaded" : "dry run:"} ${files.length} files to ${bucket}/${prefix}`)
