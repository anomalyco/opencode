#!/usr/bin/env bun
import { $ } from "bun"
import { cp, mkdir, readdir, rm } from "node:fs/promises"
import path from "node:path"
import { getConfig } from "../electron-builder.config"
import { getCurrentCli, resolveChannel } from "./utils"

// Packages the built app (out/) for OPENCODE_TARGET into dist/desktop at the repository root, unsigned:
// macOS: the .app as a tarball. Windows: the unpacked app in app/, or with OPENCODE_DESKTOP_APP, the NSIS
// installer around that (signed) app. Linux: AppImage, deb and rpm. The release workflow signs afterwards.
const dir = path.resolve(import.meta.dir, "..")

const out = path.resolve(dir, "../../dist/desktop")

const cli = getCurrentCli()

const os =
  new Map([
    ["darwin", "mac"],
    ["win32", "win"],
  ]).get(cli.os) ?? "linux"

const app = process.env.OPENCODE_DESKTOP_APP

const flags = [`--${os}`, `--${cli.cpu}`, "--publish", "never", "--config", "electron-builder.config.ts"]

process.chdir(dir)

await rm("dist", { recursive: true, force: true })

await rm(out, { recursive: true, force: true })

await mkdir(out, { recursive: true })

if (app) {
  // The installer uses the channel's icons; the rest of the app is already built and signed.
  await $`bun ./script/copy-icons.ts ${resolveChannel()}`
  await $`bunx electron-builder ${flags} --prepackaged ${app}`
  await cp(`dist/opencode-desktop-win-${cli.cpu}.exe`, path.join(out, `opencode-desktop-win-${cli.cpu}.exe`))
}

if (!app && os === "linux") {
  await $`bunx electron-builder ${flags}`
  const files = (await readdir("dist")).filter((file) => /\.(AppImage|deb|rpm)$/.test(file))
  await Promise.all(files.map((file) => cp(path.join("dist", file), path.join(out, file))))
}

if (!app && os === "mac") {
  await $`bunx electron-builder ${flags} --dir -c.mac.identity=null`
  const parent = path.join("dist", cli.cpu === "arm64" ? "mac-arm64" : "mac")
  const bundles = (await readdir(parent)).filter((file) => file.endsWith(".app"))

  if (bundles.length !== 1) throw new Error(`Expected one .app bundle in ${parent}, found ${bundles.join(", ")}`)
  await writeUpdateConfig(path.join(parent, bundles[0], "Contents", "Resources"))
  await $`tar -cf ${path.join(out, `opencode-desktop-mac-${cli.cpu}.app.tar`)} -C ${parent} ${bundles[0]}`
}

if (!app && os === "win") {
  await $`bunx electron-builder ${flags} --dir`
  const unpacked = path.join("dist", cli.cpu === "arm64" ? "win-arm64-unpacked" : "win-unpacked")
  await writeUpdateConfig(path.join(unpacked, "resources"))
  await cp(unpacked, path.join(out, "app"), { recursive: true })
}

// electron-builder writes resources/app-update.yml only for dmg, zip and nsis targets, not for --dir builds.
// electron-updater reads its feed from that file, so write the one those targets would.
async function writeUpdateConfig(resources: string) {
  const publish = getConfig().publish
  const name: string = (await Bun.file("package.json").json()).name
  await Bun.write(
    path.join(resources, "app-update.yml"),
    [
      `provider: ${publish.provider}`,
      `url: ${publish.url}`,
      `channel: ${publish.channel}`,
      `updaterCacheDirName: '${name.replace(/[/\\:*?"<>|]/g, "").toLowerCase()}-updater'`,
    ].join("\n") + "\n",
  )
}
