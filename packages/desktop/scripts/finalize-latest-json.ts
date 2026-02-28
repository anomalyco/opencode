#!/usr/bin/env bun

import { Buffer } from "node:buffer"
import { $ } from "bun"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "dry-run": { type: "boolean", default: false },
  },
})

const dryRun = values["dry-run"]

import { parseArgs } from "node:util"

const repo = process.env.GH_REPO
if (!repo) throw new Error("GH_REPO is required")

const releaseId = process.env.OPENCODE_RELEASE
if (!releaseId) throw new Error("OPENCODE_RELEASE is required")

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required")

const apiHeaders = {
  Authorization: `token ${token}`,
  Accept: "application/vnd.github+json",
}

const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/${releaseId}`, {
  headers: apiHeaders,
})

if (!releaseRes.ok) {
  throw new Error(`Failed to fetch release: ${releaseRes.status} ${releaseRes.statusText}`)
}

type Asset = {
  name: string
  url: string
  browser_download_url: string
}

type Release = {
  tag_name?: string
  assets?: Asset[]
}

const release = (await releaseRes.json()) as Release
const assets = release.assets ?? []
const assetByName = new Map(assets.map((asset) => [asset.name, asset]))

const latestAsset = assetByName.get("latest.json")
if (!latestAsset) throw new Error("latest.json asset not found")

const latestRes = await fetch(latestAsset.url, {
  headers: {
    Authorization: `token ${token}`,
    Accept: "application/octet-stream",
  },
})

if (!latestRes.ok) {
  throw new Error(`Failed to fetch latest.json: ${latestRes.status} ${latestRes.statusText}`)
}

const latestText = new TextDecoder().decode(await latestRes.arrayBuffer())
const latest = JSON.parse(latestText)
const base = { ...latest }
delete base.platforms

const fetchSignature = async (asset: Asset) => {
  const res = await fetch(asset.url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/octet-stream",
    },
  })

  if (!res.ok) {
    throw new Error(`Failed to fetch signature: ${res.status} ${res.statusText}`)
  }

  return Buffer.from(await res.arrayBuffer()).toString()
}

const entries: Record<string, { url: string; signature: string }> = {}
const add = (key: string, asset: Asset, signature: string) => {
  if (entries[key]) return
  entries[key] = {
    url: asset.browser_download_url,
    signature,
  }
}

const targets = [
  { key: "linux-x86_64-deb", asset: "opencode-desktop-linux-amd64.deb" },
  { key: "linux-x86_64-rpm", asset: "opencode-desktop-linux-x86_64.rpm" },
  { key: "linux-aarch64-deb", asset: "opencode-desktop-linux-arm64.deb" },
  { key: "linux-aarch64-rpm", asset: "opencode-desktop-linux-aarch64.rpm" },
  { key: "windows-x86_64-nsis", asset: "opencode-desktop-windows-x64.exe" },
  { key: "darwin-x86_64-app", asset: "opencode-desktop-darwin-x64.app.tar.gz" },
  {
    key: "darwin-aarch64-app",
    asset: "opencode-desktop-darwin-aarch64.app.tar.gz",
  },
]

for (const target of targets) {
  const asset = assetByName.get(target.asset)
  if (!asset) continue

  const sig = assetByName.get(`${target.asset}.sig`)
  if (!sig) continue

  const signature = await fetchSignature(sig)
  add(target.key, asset, signature)
}

const alias = (key: string, source: string) => {
  if (entries[key]) return
  const entry = entries[source]
  if (!entry) return
  entries[key] = entry
}

alias("linux-x86_64", "linux-x86_64-deb")
alias("linux-aarch64", "linux-aarch64-deb")
alias("windows-x86_64", "windows-x86_64-nsis")
alias("darwin-x86_64", "darwin-x86_64-app")
alias("darwin-aarch64", "darwin-aarch64-app")

const platforms = Object.fromEntries(
  Object.keys(entries)
    .sort()
    .map((key) => [key, entries[key]]),
)
const output = {
  ...base,
  platforms,
}

const dir = process.env.RUNNER_TEMP ?? "/tmp"
const file = `${dir}/latest.json`
await Bun.write(file, JSON.stringify(output, null, 2))

const tag = release.tag_name
if (!tag) throw new Error("Release tag not found")

if (dryRun) {
  console.log(`dry-run: wrote latest.json for ${tag} to ${file}`)
  process.exit(0)
}
await $`gh release upload ${tag} ${file} --clobber --repo ${repo}`

console.log(`finalized latest.json for ${tag}`)
