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
const lockfile = path.join(root, "bun.lock")
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
  console.log(`No opentui manifest updates needed for ${ver}`)
}

if (out.length > 0) {
  console.log(`Updated opentui${snapshot ? " snapshot" : ""} to ${ver} in:`)
  for (const file of out) {
    console.log(`- ${file}`)
  }
}

console.log("Running bun install to update bun.lock...")
const install = Bun.spawn([process.execPath, "install"], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
})
const installCode = await install.exited
if (installCode !== 0) process.exit(installCode)

const fixed = await fixKnownLockfileIssues()
if (fixed.length > 0) {
  console.log("Removed stale opentui-spinner peer lockfile entries:")
  for (const item of fixed) {
    console.log(`- ${item}`)
  }
}

const stale = await findStaleLockfileEntries()
if (stale.length > 0) {
  console.error(`bun.lock still contains stale opentui versions after upgrading to ${ver}:`)
  for (const item of stale) {
    console.error(`- ${item.entry}: ${item.pkg}@${item.version}`)
  }
  process.exit(1)
}

console.log("bun.lock opentui versions are consistent")

async function fixKnownLockfileIssues() {
  const txt = await Bun.file(lockfile).text()
  const stale = findStaleLockfileEntriesInText(txt)
  if (stale.length === 0) return []
  if (stale.some((item) => !item.entry.startsWith("opentui-spinner/@opentui/"))) return []

  const removed = txt
    .split("\n")
    .map((line) => line.match(/^    "(opentui-spinner\/@opentui\/[^\"]+)": /)?.[1])
    .filter((item): item is string => item !== undefined)

  if (removed.length === 0) return []

  await Bun.write(
    lockfile,
    txt
      .split("\n")
      .filter((line) => !line.match(/^    "opentui-spinner\/@opentui\//))
      .join("\n"),
  )
  return removed
}

async function findStaleLockfileEntries() {
  return findStaleLockfileEntriesInText(await Bun.file(lockfile).text())
}

function findStaleLockfileEntriesInText(txt: string) {
  return Array.from(txt.matchAll(/^    "([^"]+)": \["(@opentui\/(?:core(?:-[^@"]+)?|keymap|solid))@([^"]+)"/gm))
    .map((match) => ({
      entry: match[1]!,
      pkg: match[2]!,
      version: match[3]!,
    }))
    .filter((item) => item.version !== ver)
}
