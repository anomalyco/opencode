#!/usr/bin/env bun

// Uploads one platform's desktop release files to R2 from its build job and writes the returned file list, which
// publish.ts reads through OPENCODE_DESKTOP_UPLOADED instead of uploading every platform itself.
// Usage: bun scripts/upload.ts <dist directory> <output json>
import path from "node:path"
import { UpdateArtifact } from "../../../script/update-artifact"

const [directory, output] = process.argv.slice(2)

if (!directory || !output) throw new Error("Usage: bun scripts/upload.ts <dist directory> <output json>")

const version = process.env.OPENCODE_VERSION

if (!version) throw new Error("OPENCODE_VERSION is required")

const files = (
  await Array.fromAsync(
    new Bun.Glob("*.{exe,blockmap,dmg,zip,AppImage,deb,rpm,app.tar.gz}").scan({
      cwd: path.resolve(directory),
      absolute: true,
    }),
  )
).sort()

if (!files.length) throw new Error(`No desktop release files found in ${directory}`)

await Bun.write(output, JSON.stringify(await UpdateArtifact.upload({ version, files }), null, 2))
