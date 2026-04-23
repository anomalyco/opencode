#!/usr/bin/env bun

import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

if (process.platform !== "win32") {
  const root = path.join(dir, "node_modules", "node-pty", "prebuilds")
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const files = dirs.filter((x) => x.isDirectory()).map((x) => path.join(root, x.name, "spawn-helper"))
  const result = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(file).catch(() => undefined)
      if (!stat) return
      if ((stat.mode & 0o111) === 0o111) return
      await fs.chmod(file, stat.mode | 0o755)
      return file
    }),
  )
  const fixed = result.filter(Boolean)
  if (fixed.length) {
    console.log(`fixed node-pty permissions for ${fixed.length} helper${fixed.length === 1 ? "" : "s"}`)
  }
}
