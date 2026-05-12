#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"

const dir = path.resolve(import.meta.dir, "..")
const os = process.platform === "win32" ? "windows" : process.platform
const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch
const bin = os === "windows" ? "opencode.exe" : "opencode"
const src = path.join(dir, "dist", `opencode-${os}-${arch}`, "bin", bin)
const dst = path.join(process.env.HOME || "", ".local", "bin", bin)

process.chdir(dir)

await $`mkdir -p ${path.dirname(dst)}`
await $`cp ${src} ${dst}`

if (os !== "windows") {
  await $`chmod +x ${dst}`
}

if (os === "darwin") {
  await $`codesign --remove-signature ${dst}`.nothrow()
  await $`codesign --force --sign - ${dst}`
  await $`codesign --verify --verbose=4 ${dst}`
}
