#!/usr/bin/env bun

import { $ } from "bun"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const dist = path.join(root, "packages", "opencode", "dist")
const out = path.join(dist, "securecode-release")
const repo = process.env.GH_REPO ?? process.env.GITHUB_REPOSITORY
const tag = process.env.SECURECODE_TAG ?? version()
const skip = process.env.SECURECODE_SKIP_UPLOAD === "1"

if (!skip && !repo) {
  throw new Error("GH_REPO or GITHUB_REPOSITORY is required")
}

await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, { recursive: true })

const sums: string[] = []
for (const dir of await fs.readdir(dist, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  if (!dir.name.startsWith("opencode-")) continue

  const meta = path.join(dist, dir.name, "package.json")
  if (!(await exists(meta))) continue

  const win = dir.name.includes("windows")
  const src = await bin(path.join(dist, dir.name, "bin"), win)
  if (!src) continue

  const name = dir.name.replace(/^opencode-/, "securecode-")
  const ext = win || dir.name.includes("darwin") ? "zip" : "tar.gz"
  const tmp = path.join(out, name)
  const dst = path.join(tmp, `securecode${win ? ".exe" : ""}`)
  const arc = path.join(out, `${name}.${ext}`)

  await fs.rm(tmp, { recursive: true, force: true })
  await fs.mkdir(tmp, { recursive: true })
  await fs.copyFile(src, dst)
  if (!win) await fs.chmod(dst, 0o755)
  await fs.copyFile(path.join(root, "LICENSE"), path.join(tmp, "LICENSE"))
  await Bun.write(path.join(tmp, "README.txt"), note(name, win))

  if (ext === "zip") {
    await $`zip -rq ${arc} .`.cwd(tmp)
  } else {
    await $`tar -czf ${arc} -C ${tmp} .`
  }

  sums.push(`${sum(await Bun.file(arc).bytes())}  ${path.basename(arc)}`)
}

if (sums.length === 0) {
  throw new Error("No CLI binaries found in packages/opencode/dist")
}

const sumfile = path.join(out, "securecode-sha256.txt")
await Bun.write(sumfile, sums.join("\n") + "\n")

const files = (await fs.readdir(out))
  .filter((x) => x === "securecode-sha256.txt" || x.endsWith(".zip") || x.endsWith(".tar.gz"))
  .map((x) => path.join(out, x))
  .sort()

if (skip) {
  console.log("Prepared assets:")
  for (const file of files) console.log(path.basename(file))
  process.exit(0)
}

await $`gh release upload ${tag} ${files} --clobber --repo ${repo}`

function version() {
  const raw = process.env.OPENCODE_VERSION
  if (!raw) throw new Error("SECURECODE_TAG or OPENCODE_VERSION is required")
  return `v${raw}`
}

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

async function bin(dir: string, win: boolean) {
  const list = win ? ["opencode.exe", "opencode"] : ["opencode"]
  for (const file of list) {
    const full = path.join(dir, file)
    if (await exists(full)) return full
  }
}

function sum(buf: Uint8Array) {
  return createHash("sha256").update(buf).digest("hex")
}

function note(name: string, win: boolean) {
  const cmd = win ? "securecode.exe" : "./securecode"
  return [
    "Acompany Secure Code CLI",
    "",
    `Asset: ${name}`,
    "",
    "Quick start:",
    `  1. Run ${cmd} run \"Summarize this repository\"`,
    "  2. Create opencode.json to pin the default model",
    "  3. See the repository README for install and configuration details",
    "",
    "Note:",
    "  The config filename remains opencode.json for upstream compatibility.",
    "",
  ].join("\n")
}
