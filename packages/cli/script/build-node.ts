#!/usr/bin/env bun

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmod, copyFile, mkdir, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { build } from "vite"
import { Script } from "@opencode-ai/script"
import pkg from "../package.json"
import { modelsData } from "./generate"
import { collectNodeAssets, copyNodeAssets, hashNodeAssets, seaAssetMap } from "./node-assets"
import { mainConfig } from "../vite.node.config"
import { nodeExecArgv, nodeTarget, type NodeTarget } from "../src/node/target"

const NODE_VERSION = "26.4.0"
const dir = path.resolve(import.meta.dirname, "..")
const bundleOnly = process.argv.includes("--bundle-only")
const single = process.argv.includes("--single")
const skipInstall = process.argv.includes("--skip-install")
const requested = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
const allTargets = [
  nodeTarget("linux", "arm64"),
  nodeTarget("linux", "x64"),
  nodeTarget("darwin", "arm64"),
  nodeTarget("win32", "arm64"),
  nodeTarget("win32", "x64"),
]
const targets = requested
  ? allTargets.filter((target) => targetName(target) === requested)
  : single || bundleOnly
    ? [nodeTarget(process.platform, process.arch)]
    : allTargets

if (targets.length === 0) {
  if (requested === "darwin-x64") throw new Error("Node 26.4 SEA does not support macOS x64")
  throw new Error(`Unknown Node target: ${requested}`)
}
if (!bundleOnly && targets.some((target) => target.platform === "darwin" && target.arch === "x64")) {
  throw new Error("Node 26.4 SEA does not support macOS x64")
}

process.chdir(dir)
if (!skipInstall) run(process.execPath, ["install", "--os=*", "--cpu=*"])
if (!bundleOnly) await rm("dist", { recursive: true, force: true })
const builder =
  !bundleOnly || targets.some((target) => target.platform === process.platform && target.arch === process.arch)
    ? await resolveHostNode()
    : undefined

for (const target of targets) {
  console.log(`building cli-${targetName(target)}`)
  const assets = await collectNodeAssets(target)
  await rm("dist-node", { recursive: true, force: true })
  const assetHash = await hashNodeAssets(assets)
  const input = { version: Script.version, channel: Script.channel, models: modelsData, assetHash, target }
  await build(mainConfig(input))
  await copyNodeAssets(assets)

  const host = target.platform === process.platform && target.arch === process.arch
  if (host) {
    if (!builder) throw new Error("Node SEA builder is unavailable")
    run(builder, [...nodeExecArgv, "dist-node/opencode.mjs", "--version"])
    run(builder, [...nodeExecArgv, "dist-node/opencode.mjs", "--help"])
  }
  if (bundleOnly) continue

  const name = `cli-${targetName(target)}`
  const binary = target.platform === "win32" ? "opencode2.exe" : "opencode2"
  const output = path.join(dir, "dist", name, "bin", binary)
  if (!builder) throw new Error("Node SEA builder is unavailable")
  await mkdir(path.dirname(output), { recursive: true })
  const config = {
    main: "dist-node/opencode.mjs",
    mainFormat: "module",
    executable: await resolveTargetNode(target, builder),
    output: path.relative(dir, output),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    execArgv: nodeExecArgv,
    execArgvExtension: "none",
    assets: await seaAssetMap(),
  }
  await writeFile("dist-node/sea.json", `${JSON.stringify(config, null, 2)}\n`)
  run(builder, ["--build-sea", "dist-node/sea.json"])
  if (target.platform !== "win32") await chmod(output, 0o755)
  if (target.platform === "darwin" && process.platform === "darwin") run("codesign", ["--sign", "-", output])
  if (target.platform === "darwin" && process.platform !== "darwin") {
    console.warn(`${output} must be signed on macOS before it can run`)
  }
  await writeFile(
    path.join(dir, "dist", name, "package.json"),
    `${JSON.stringify(
      {
        name: `@opencode-ai/${name}`,
        version: Script.version,
        license: pkg.license,
        repository: { type: "git", url: "git+https://github.com/anomalyco/opencode.git" },
        os: [target.platform],
        cpu: [target.arch],
      },
      null,
      2,
    )}\n`,
  )
  if (host) await smoke(output)
}

async function resolveHostNode() {
  const candidates = [process.env.NODE_BIN, "node"].filter((item): item is string => Boolean(item))
  for (const candidate of candidates) {
    const result = spawnSync(
      candidate,
      ["-p", "JSON.stringify({version:process.versions.node,path:process.execPath})"],
      {
        encoding: "utf8",
      },
    )
    if (result.status !== 0) continue
    const info = JSON.parse(result.stdout) as { version: string; path: string }
    if (info.version === NODE_VERSION) return realpath(info.path)
  }
  return resolveTargetNode(nodeTarget(process.platform, process.arch))
}

async function resolveTargetNode(target: NodeTarget, host?: string) {
  if (host && target.platform === process.platform && target.arch === process.arch) return host
  const cache = path.resolve(dir, ".cache", "node")
  const platform = target.platform === "win32" ? "win" : target.platform
  const archiveName = `node-v${NODE_VERSION}-${platform}-${target.arch}`
  const targetDirectory = path.join(cache, archiveName)
  const executable = path.join(targetDirectory, target.platform === "win32" ? "node.exe" : "bin/node")
  if (
    (await stat(executable).then(
      () => true,
      () => false,
    )) &&
    (await stat(path.join(targetDirectory, ".verified")).then(
      () => true,
      () => false,
    ))
  )
    return realpath(executable)
  await mkdir(cache, { recursive: true })
  const extension = target.platform === "win32" ? "zip" : "tar.gz"
  const filename = `${archiveName}.${extension}`
  const archive = path.join(cache, filename)
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`
  const [response, sums] = await Promise.all([fetch(`${base}/${filename}`), fetch(`${base}/SHASUMS256.txt`)])
  if (!response.ok) throw new Error(`Failed to download Node ${NODE_VERSION}: ${response.status}`)
  if (!sums.ok) throw new Error(`Failed to download Node ${NODE_VERSION} checksums: ${sums.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  const expected = (await sums.text())
    .split("\n")
    .find((line) => line.endsWith(`  ${filename}`))
    ?.split(/\s+/)[0]
  if (!expected) throw new Error(`Missing checksum for ${filename}`)
  if (createHash("sha256").update(data).digest("hex") !== expected) throw new Error(`Checksum mismatch for ${filename}`)
  await writeFile(archive, data)
  const temporary = path.join(cache, `${archiveName}.${process.pid}.tmp`)
  await rm(temporary, { recursive: true, force: true })
  await mkdir(temporary)
  if (target.platform !== "win32") run("tar", ["-xzf", archive, "-C", temporary])
  else if (process.platform === "win32") run("tar", ["-xf", archive, "-C", temporary])
  else run("unzip", ["-q", archive, "-d", temporary])
  await rm(targetDirectory, { recursive: true, force: true })
  await rename(path.join(temporary, archiveName), targetDirectory)
  await writeFile(path.join(targetDirectory, ".verified"), `${expected}\n`)
  await rm(temporary, { recursive: true, force: true })
  await rm(archive, { force: true })
  return realpath(executable)
}

async function smoke(output: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-node-smoke-"))
  const executable = path.join(root, path.basename(output))
  await copyFile(output, executable)
  if (process.platform !== "win32") await chmod(executable, 0o755)
  run(executable, ["--version"], root)
  run(executable, ["--help"], root)
  await rm(root, { recursive: true, force: true })
}

function targetName(target: NodeTarget) {
  return `${target.platform === "win32" ? "windows" : target.platform}-${target.arch}`
}

function run(command: string, args: readonly string[], cwd = dir) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? "unknown"}`)
}
