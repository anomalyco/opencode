import { $ } from "bun"
import { cp, mkdir, readdir } from "node:fs/promises"
import path from "node:path"

process.chdir(path.resolve(import.meta.dir, "../packages/desktop"))
const target = process.env.RELEASE_TARGET
if (!target || !/^(darwin|windows|linux)-(x64|arm64)$/.test(target)) throw new Error("Unexpected RELEASE_TARGET")
const [platform, arch] = target.split("-")
const flag = platform === "darwin" ? "--mac" : platform === "windows" ? "--win" : "--linux"
const out = path.resolve("../../dist/release/desktop")
await mkdir(out, { recursive: true })
process.env.OPENCODE_CHANNEL = "prod"
process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false"
process.env.OPENCODE_UNSIGNED = "true"
const prepackaged = process.env.SIGNED_APP
if (!prepackaged) {
  await $`bun scripts/prepare.ts`
  await $`bun run build`
}
const args = prepackaged ? ["--prepackaged", prepackaged] : platform === "linux" ? [] : ["--dir"]
await $`bun x --no-install electron-builder ${flag} ${"--" + arch} ${args} --publish never --config electron-builder.config.ts`
if (platform === "darwin") {
  const dir = arch === "x64" ? "dist/mac" : "dist/mac-arm64"
  await $`tar -cf ${out}/opencode-desktop-mac-${arch}.app.tar -C ${dir} OpenCode.app`
} else if (platform === "windows" && !prepackaged) {
  await cp(arch === "arm64" ? "dist/win-arm64-unpacked" : "dist/win-unpacked", `${out}/app`, { recursive: true })
} else {
  for (const file of await readdir("dist")) {
    if (/^opencode-desktop-.*\.(AppImage|deb|rpm|exe)$/.test(file)) await cp(`dist/${file}`, `${out}/${file}`)
  }
}
