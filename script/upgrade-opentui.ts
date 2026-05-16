#!/usr/bin/env bun

import path from "node:path"

const args = process.argv.slice(2)
const usage = "Usage: bun run script/upgrade-opentui.ts [--snapshot] <version>"

if (args.includes("--help") || args.includes("-h")) {
  console.log(usage)
  process.exit(0)
}

const snapshotArg = args.find((arg) => arg.startsWith("--snapshot="))
const snapshot = args.includes("--snapshot") || snapshotArg !== undefined
const unknown = args.find((arg) => arg.startsWith("-") && arg !== "--snapshot" && !arg.startsWith("--snapshot="))
if (unknown) {
  console.error(`Unknown option: ${unknown}`)
  console.error(usage)
  process.exit(1)
}

const positional = args.filter((arg) => arg !== "--snapshot" && !arg.startsWith("--snapshot="))
const raw = snapshotArg?.slice("--snapshot=".length) || positional[0]
if (!raw || positional.length > (snapshotArg ? 0 : 1)) {
  console.error(usage)
  process.exit(1)
}

if (snapshotArg === "--snapshot=") {
  console.error("Missing snapshot version")
  console.error(usage)
  process.exit(1)
}

const ver = raw.replace(/^v/, "")
const root = path.resolve(import.meta.dir, "..")
const skip = new Set([".git", ".opencode", ".turbo", "dist", "node_modules"])
const keys = ["@opentui/core", "@opentui/keymap", "@opentui/solid"] as const

const files = (await Array.fromAsync(new Bun.Glob("**/package.json").scan({ cwd: root }))).filter(
  (file) => !file.split("/").some((part) => skip.has(part)),
)

const setVersion = (cur: string, kind: "dep" | "peer") => {
  if (cur === "catalog:" || cur.startsWith("workspace:")) return cur
  if (snapshot) return ver
  if (kind === "peer") return `>=${ver}`
  if (cur.startsWith(">=")) return `>=${ver}`
  if (cur.startsWith("^")) return `^${ver}`
  if (cur.startsWith("~")) return `~${ver}`
  return ver
}

const editDeps = (obj: unknown, kind: "dep" | "peer") => {
  if (!obj || typeof obj !== "object") return false
  const map = obj as Record<string, unknown>
  return keys
    .map((key) => {
      const cur = map[key]
      if (typeof cur !== "string") return false
      const next = setVersion(cur, kind)
      if (next === cur) return false
      map[key] = next
      return true
    })
    .some(Boolean)
}

const editCatalog = (obj: unknown) => {
  if (!obj || typeof obj !== "object") return false
  const map = obj as Record<string, unknown>
  return keys
    .map((key) => {
      const cur = map[key]
      if (typeof cur !== "string" || cur === ver) return false
      map[key] = ver
      return true
    })
    .some(Boolean)
}

const editOverrides = (obj: unknown) => {
  if (!obj || typeof obj !== "object") return false
  const map = obj as Record<string, unknown>
  return keys
    .map((key) => {
      const cur = map[key]
      if (typeof cur !== "string") return false
      const next = snapshot ? ver : "catalog:"
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
      const hit = [
        editCatalog(json.workspaces?.catalog),
        editOverrides(json.overrides),
        editDeps(json.dependencies, "dep"),
        editDeps(json.devDependencies, "dep"),
        editDeps(json.peerDependencies, "peer"),
      ].some(Boolean)
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

console.log(`Updated opentui${snapshot ? " snapshot" : ""} to ${ver} in:`)
for (const file of out) {
  console.log(`- ${file}`)
}
