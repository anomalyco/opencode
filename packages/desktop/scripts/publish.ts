#!/usr/bin/env bun

import { Script } from "@opencode/script"
import { $ } from "bun"
import path from "node:path"
import { UpdateArtifact } from "../../../script/update-artifact"

const dryRun = process.argv.includes("--dry-run")
if (!Script.release) {
  console.log("skipped desktop publication without a release")
  process.exit(0)
}
const repo = process.env.GH_REPO
if (!repo) throw new Error("GH_REPO is required")
const directory = process.env.OPENCODE_DESKTOP_DIST
if (!directory) throw new Error("OPENCODE_DESKTOP_DIST is required")
const tag = `v${Script.version}`
const files = (
  await Array.fromAsync(
    new Bun.Glob("*.{exe,blockmap,dmg,zip,AppImage,deb,rpm,app.tar.gz}").scan({ cwd: directory, absolute: true }),
  )
).sort()
if (!files.length) throw new Error("No desktop release files found")

if (!dryRun) {
  await $`gh release upload ${tag} ${files} --clobber --repo ${repo}`
  await $`bun ${path.join(import.meta.dir, "finalize-latest-json.ts")}`
  await $`bun ${path.join(import.meta.dir, "finalize-latest-yml.ts")}`
}

const uploaded = await UpdateArtifact.upload({ version: Script.version, files, dryRun })
const artifacts = [
  { distribution: "github", metadata: await metadata(Script.version, repo) },
  { distribution: "opencode", metadata: { files: uploaded, ...(await metadata(Script.version, repo, uploaded)) } },
]

if (!dryRun) await $`gh release edit ${tag} --draft=false --repo ${repo}`
for (const artifact of artifacts) {
  const input = { ...artifact, channel: Script.channel, name: "desktop", version: Script.version }
  if (dryRun) console.log(`dry-run artifact: ${JSON.stringify(input)}`)
  if (!dryRun) await UpdateArtifact.publish(input)
}

type DesktopFile = {
  url: string
  sha512: string
  size: number
  blockMapSize?: number
}

async function metadata(version: string, repo: string, files?: Record<string, { url: string }>) {
  const directory = process.env.RUNNER_TEMP ?? "/tmp"
  const entries = await Promise.all(
    [
      ["desktop.yml", "latest.yml"],
      ["desktop-mac.yml", "latest-mac.yml"],
      ["desktop-linux.yml", "latest-linux.yml"],
      ["desktop-linux-arm64.yml", "latest-linux-arm64.yml"],
    ].map(async ([name, source]) => {
      const file = Bun.file(`${directory}/${source}`)
      if (!(await file.exists())) return undefined
      return [name, parse(await file.text(), version, repo, files)] as const
    }),
  )
  const manifests = Object.fromEntries(entries.filter((entry) => entry !== undefined))
  if (!Object.keys(manifests).length) throw new Error("No desktop update metadata found")
  return { manifests }
}

function parse(content: string, version: string, repo: string, uploaded?: Record<string, { url: string }>) {
  const lines = content.split("\n")
  const found = lines
    .find((line) => line.startsWith("version:"))
    ?.slice("version:".length)
    .trim()
  if (found !== version) throw new Error(`Desktop metadata version mismatch: expected ${version}, got ${found}`)
  const releaseDate = lines
    .find((line) => line.startsWith("releaseDate:"))
    ?.slice("releaseDate:".length)
    .trim()
    .replace(/^['"]|['"]$/g, "")
  if (!releaseDate) throw new Error("Desktop metadata did not include a release date")
  const files: DesktopFile[] = []
  lines.forEach((line) => {
    const value = line.trim()
    if (value.startsWith("- url:")) {
      const name = value.slice("- url:".length).trim()
      const filename = name.startsWith("http") ? decodeURIComponent(new URL(name).pathname.split("/").pop()!) : name
      const url = uploaded
        ? uploaded[filename]?.url
        : name.startsWith("http")
          ? name
          : `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(name)}`
      if (!url) throw new Error(`Desktop update file was not uploaded: ${filename}`)
      files.push({ url, sha512: "", size: 0 })
      return
    }
    const current = files.at(-1)
    if (!current) return
    if (value.startsWith("sha512:")) current.sha512 = value.slice("sha512:".length).trim()
    if (value.startsWith("size:")) current.size = Number(value.slice("size:".length).trim())
    if (value.startsWith("blockMapSize:")) current.blockMapSize = Number(value.slice("blockMapSize:".length).trim())
  })
  if (!files.length || files.some((file) => !file.sha512 || !file.size))
    throw new Error("Desktop metadata contained an incomplete file")
  return { files, releaseDate }
}
