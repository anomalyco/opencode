#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs/promises"
import os from "os"
import path from "path"

const repoRoot = path.resolve(import.meta.dir, "..")

const archMap: Record<string, string> = {
  x64: "x64",
  arm64: "arm64",
}

const platformMap: Record<string, string> = {
  linux: "linux",
  darwin: "darwin",
}

const platform = platformMap[process.platform]
const arch = archMap[process.arch]

if (!platform || !arch) {
  throw new Error(`Unsupported platform/arch: ${process.platform}/${process.arch}`)
}

const binaryPath = path.join(repoRoot, "packages", "opencode", "dist", `opencode-${platform}-${arch}`, "bin", "opencode")

const home = os.homedir()
const binDir = path.join(home, ".local", "bin")
const symlinkPath = path.join(binDir, "opencode")

const appsDir = path.join(home, ".local", "share", "applications")
const desktopEntryPath = path.join(appsDir, "opencode.desktop")

const iconDir = path.join(home, ".local", "share", "icons", "hicolor", "128x128", "apps")
const iconPath = path.join(iconDir, "opencode.png")

const sourceIconPath = path.join(repoRoot, "packages", "desktop", "src-tauri", "icons", "prod", "128x128.png")

if (process.env.OPENCODE_INSTALL_RUNNING === "1") {
  process.exit(0)
}

process.env.OPENCODE_INSTALL_RUNNING = "1"

console.log("Installing dependencies...")
await $`bun install --ignore-scripts`.cwd(repoRoot).env(process.env)

console.log("Building opencode binary...")
await $`bun run script/build.ts --single`.cwd(path.join(repoRoot, "packages", "opencode")).env(process.env)

if (process.platform === "linux") {
  const rustTarget =
    process.arch === "x64"
      ? "x86_64-unknown-linux-gnu"
      : process.arch === "arm64"
        ? "aarch64-unknown-linux-gnu"
        : null

  if (!rustTarget) {
    throw new Error(`Unsupported Linux arch for desktop build: ${process.arch}`)
  }

  console.log("Building desktop binary...")

  await $`bun run ./scripts/predev.ts`
    .cwd(path.join(repoRoot, "packages", "desktop"))
    .env({
      ...process.env,
      RUST_TARGET: rustTarget,
    })

  await $`bun run tauri build --target ${rustTarget} --config ./src-tauri/tauri.local.conf.json`
    .cwd(path.join(repoRoot, "packages", "desktop"))
    .env(process.env)
}

await fs.mkdir(binDir, { recursive: true })
await fs.rm(symlinkPath, { force: true })
await fs.symlink(binaryPath, symlinkPath)

await fs.mkdir(appsDir, { recursive: true })
await fs.mkdir(iconDir, { recursive: true })
await fs.copyFile(sourceIconPath, iconPath)

const desktopEntry = `[Desktop Entry]
Type=Application
Version=1.0
Name=OpenCode
Comment=Open source AI coding agent
Exec=opencode desktop
TryExec=opencode
Icon=opencode
Terminal=false
Categories=Development;
MimeType=x-scheme-handler/opencode;
StartupNotify=true
`

await fs.writeFile(desktopEntryPath, desktopEntry)

await $`update-desktop-database ${appsDir}`.nothrow()
await $`gtk-update-icon-cache -f -t ${path.join(home, ".local", "share", "icons", "hicolor")}`.nothrow()

console.log("Local install complete")
console.log(`Binary symlink: ${symlinkPath} -> ${binaryPath}`)
console.log(`Desktop entry:  ${desktopEntryPath}`)
