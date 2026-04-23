#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const root = path.resolve(dir, "../..")

function linker(): "hoisted" | "isolated" {
  // jsonc-parser is only declared in packages/opencode, so its install location
  // tells us whether Bun used a hoisted or isolated workspace layout.
  if (fs.existsSync(path.join(dir, "node_modules", "jsonc-parser"))) return "isolated"
  if (fs.existsSync(path.join(root, "node_modules", "jsonc-parser"))) return "hoisted"
  throw new Error("Could not detect Bun linker from jsonc-parser")
}

process.chdir(dir)

// Load migrations from migration directories
const migrationDirs = (
  await fs.promises.readdir(path.join(dir, "migration"), {
    withFileTypes: true,
  })
)
  .filter((entry) => entry.isDirectory() && /^\d{4}\d{2}\d{2}\d{2}\d{2}\d{2}/.test(entry.name))
  .map((entry) => entry.name)
  .sort()

const migrations = await Promise.all(
  migrationDirs.map(async (name) => {
    const file = path.join(dir, "migration", name, "migration.sql")
    const sql = await Bun.file(file).text()
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(name)
    const timestamp = match
      ? Date.UTC(
          Number(match[1]),
          Number(match[2]) - 1,
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        )
      : 0
    return { sql, timestamp, name }
  }),
)
console.log(`Loaded ${migrations.length} migrations`)

const link = linker()

await $`bun install --linker=${link} --os="*" --cpu="*" @lydell/node-pty@1.2.0-beta.10`

await Bun.build({
  target: "node",
  entrypoints: ["./src/node.ts"],
  outdir: "./dist",
  format: "esm",
  sourcemap: "linked",
  external: ["jsonc-parser"],
  define: {
    OPENCODE_MIGRATIONS: JSON.stringify(migrations),
    OPENCODE_CHANNEL: `'${Script.channel}'`,
  },
})

console.log("Build complete")
