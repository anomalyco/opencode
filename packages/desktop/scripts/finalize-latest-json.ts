#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
  },
})

const dryRun = values["dry-run"]

const repo = process.env.GH_REPO
if (!repo) throw new Error("GH_REPO is required")

const releaseId = process.env.OPENCODE_RELEASE
if (!releaseId) throw new Error("OPENCODE_RELEASE is required")

const version = process.env.OPENCODE_VERSION
if (!version) throw new Error("OPENCODE_VERSION is required")

const dir = process.env.LATEST_YML_DIR
if (!dir) throw new Error("LATEST_YML_DIR is required")
const root = dir

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required")

const rel = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}`, {
  headers: {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
  },
})

if (!rel.ok) {
  throw new Error(`Failed to fetch release: ${rel.status} ${rel.statusText}`)
}

type Asset = {
  name: string
  url: string
}

type Release = {
  assets?: Asset[]
}

const assets = ((await rel.json()) as Release).assets ?? []
const amap = new Map(assets.map((item) => [item.name, item]))

type Item = {
  url: string
}

type Yml = {
  version: string
  files: Item[]
}

function parse(text: string): Yml {
  const lines = text.split("\n")
  let version = ""
  const files: Item[] = []
  let url = ""

  const flush = () => {
    if (!url) return
    files.push({ url })
    url = ""
  }

  for (const line of lines) {
    const trim = line.trim()
    if (line.startsWith("version:")) {
      version = line.slice("version:".length).trim()
      continue
    }
    if (trim.startsWith("- url:")) {
      flush()
      url = trim.slice("- url:".length).trim()
      continue
    }
    const indented = line.startsWith("  ") || line.startsWith("\t")
    if (!indented) flush()
  }
  flush()

  return { version, files }
}

async function read(sub: string, file: string) {
  const item = Bun.file(path.join(root, sub, file))
  if (!(await item.exists())) return undefined
  return parse(await item.text())
}

function link(raw: string) {
  if (raw.startsWith("https://") || raw.startsWith("http://")) return raw
  return `https://github.com/${repo}/releases/download/v${version}/${raw}`
}

async function sign(url: string, key: string) {
  const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? key)
  const asset = amap.get(name)
  const res = await fetch(asset?.url ?? url, {
    headers: {
      Authorization: `token ${token}`,
      ...(asset ? { Accept: "application/octet-stream" } : {}),
    },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch file ${name}: ${res.status} ${res.statusText} (${asset?.url ?? url})`)
  }

  const tmp = process.env.RUNNER_TEMP ?? "/tmp"
  const file = path.join(tmp, name)
  await Bun.write(file, await res.arrayBuffer())
  await $`bunx @tauri-apps/cli signer sign ${file}`
  const sigFile = Bun.file(`${file}.sig`)
  if (!(await sigFile.exists())) throw new Error(`Signature file not found for ${name}`)
  return (await sigFile.text()).trim()
}

const add = async (data: Record<string, { url: string; signature: string }>, key: string, raw: string | undefined) => {
  if (!raw) return
  if (data[key]) return
  const url = link(raw)
  data[key] = { url, signature: await sign(url, key) }
}

const alias = (data: Record<string, { url: string; signature: string }>, key: string, src: string) => {
  if (data[key]) return
  if (!data[src]) return
  data[key] = data[src]
}

const macx = await read("latest-yml-x86_64-apple-darwin", "latest-mac.yml")
const maca = await read("latest-yml-aarch64-apple-darwin", "latest-mac.yml")

const yver = macx?.version ?? maca?.version
if (yver && yver !== version) throw new Error(`latest.yml version mismatch: expected ${version}, got ${yver}`)

const out: Record<string, { url: string; signature: string }> = {}

const macxTarGz = "opencode-desktop-mac-x64.app.tar.gz"
const macaTarGz = "opencode-desktop-mac-arm64.app.tar.gz"

await add(out, "darwin-x86_64-app", macxTarGz)
await add(out, "darwin-aarch64-app", macaTarGz)

alias(out, "darwin-x86_64", "darwin-x86_64-app")
alias(out, "darwin-aarch64", "darwin-aarch64-app")

const platforms = Object.fromEntries(
  Object.keys(out)
    .sort()
    .map((key) => [key, out[key]]),
)

if (!Object.keys(platforms).length) throw new Error("No updater files found in latest.yml artifacts")

const data = {
  version,
  notes: "",
  pub_date: new Date().toISOString(),
  platforms,
}

const tmp = process.env.RUNNER_TEMP ?? "/tmp"
const file = path.join(tmp, "latest.json")
await Bun.write(file, JSON.stringify(data, null, 2))

const tag = `v${version}`

if (dryRun) {
  console.log(`dry-run: wrote latest.json for ${tag} to ${file}`)
  process.exit(0)
}
await $`gh release upload ${tag} ${file} --clobber --repo ${repo}`

console.log(`finalized latest.json for ${tag}`)
