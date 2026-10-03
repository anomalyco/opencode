#!/usr/bin/env bun

import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const arch = args.includes("--arm64") ? "arm64" : "x64"
const rustTarget = arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc"
const env = Object.fromEntries(
  Object.entries({
    ...process.env,
    OPENCODE_TARGET_PLATFORM: "win32",
    OPENCODE_TARGET_ARCH: arch,
    RUST_TARGET: rustTarget,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined),
)

async function run(command: string, args: string[]) {
  const proc = Bun.spawn([command, ...args], {
    cwd: packageDir,
    env,
    stdio: ["inherit", "inherit", "inherit"],
  })
  const code = await proc.exited
  if (code !== 0) process.exit(code)
}

await run(process.execPath, ["run", "build"])
await run("electron-builder", ["--win", `--${arch}`, "--config", "electron-builder.config.ts"])
