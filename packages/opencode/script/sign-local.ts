#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"

const dir = path.resolve(import.meta.dir, "..")
const os = process.platform === "win32" ? "windows" : process.platform

if (os !== "darwin") process.exit(0)

const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch
const bin = path.join(dir, "dist", `opencode-${os}-${arch}`, "bin", "opencode")

process.chdir(dir)

await $`codesign --remove-signature ${bin}`.nothrow()
await $`codesign --force --sign - ${bin}`
await $`codesign --verify --verbose=4 ${bin}`
