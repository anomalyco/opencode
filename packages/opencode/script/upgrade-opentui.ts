#!/usr/bin/env bun

import path from "node:path"

const raw = process.argv[2]
if (!raw) {
  console.error("Usage: bun run script/upgrade-opentui.ts <version>")
  process.exit(1)
}

const ver = raw.replace(/^v/, "")
const root = path.resolve(import.meta.dir, "../../..")
const skip = new Set([".git", ".opencode", ".turbo", "dist", "node_modules"])
const keys = ["@opentui/core", "@opentui/solid"] as const

const files = (await Array.fromAsync(new Bun.Glob("**/package.json").scan({ cwd: root }))).filter(
  (file) => !file.split("/").some((part) => skip.has(part)),
)

const set = (cur: string) => {
  if (cur.startsWith(">=")) return `>=${ver}`
  if (cur.startsWith("^")) return `^${ver}`
  if (cur.startsWith("~")) return `~${ver}`
  return ver
}

const edit = (obj: unknown) => {
  if (!obj || typeof obj !== "object") return false
  const map = obj as Record<string, unknown>
  return keys
    .map((key) => {
      const cur = map[key]
      if (typeof cur !== "string") return false
      const next = set(cur)
      if (next === cur) return false
      map[key] = next
      return true
    })
    .some(Boolean)
}

const out = (
  await Promise.all(
    files.map(async (rel) => {
      const file = path.join(root, rel)
      const txt = await Bun.file(file).text()
      const json = JSON.parse(txt)
      const hit = [json.dependencies, json.devDependencies, json.peerDependencies].map(edit).some(Boolean)
      if (!hit) return null
      await Bun.write(file, `${JSON.stringify(json, null, 2)}\n`)
      return rel
    }),
  )
).filter((item): item is string => item !== null)

if (out.length === 0) {
  console.log("No opentui deps found")
  process.exit(0)
}

console.log(`Updated opentui to ${ver} in:`)
for (const file of out) {
  console.log(`- ${file}`)
}
