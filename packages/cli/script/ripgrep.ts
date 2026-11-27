import { $ } from "bun"
import { createHash } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { PLATFORM, VERSION } from "../../core/src/ripgrep/release"

// ripgrep is dual-licensed under the Unlicense and MIT, so the release executables can carry it unmodified.
export async function resolveRipgrep(target: { readonly os: string; readonly arch: string; readonly abi?: "musl" }) {
  // ripgrep publishes no arm64 musl build; those builds keep resolving rg at runtime.
  if (target.os === "linux" && target.arch === "arm64" && target.abi === "musl") return undefined
  const config = PLATFORM[`${target.arch}-${target.os}` as keyof typeof PLATFORM]
  if (!config) return undefined

  const directory = path.resolve(import.meta.dirname, "..", ".cache", "ripgrep", `${VERSION}-${config.platform}`)
  const executable = path.join(
    directory,
    `ripgrep-${VERSION}-${config.platform}`,
    target.os === "win32" ? "rg.exe" : "rg",
  )
  if (await Bun.file(executable).exists()) return executable

  const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
  const response = await fetch(`https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`)
  if (!response.ok) throw new Error(`Failed to download ${filename}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (createHash("sha256").update(bytes).digest("hex") !== config.sha256)
    throw new Error(`Checksum mismatch for ${filename}`)

  await rm(directory, { recursive: true, force: true })
  await mkdir(directory, { recursive: true })
  const archive = path.join(directory, filename)
  await Bun.write(archive, bytes)
  if (config.extension === "zip") await $`unzip -oq ${archive} -d ${directory}`
  else await $`tar -xzf ${archive} -C ${directory}`
  await rm(archive)
  if (!(await Bun.file(executable).exists())) throw new Error(`${filename} did not contain ${executable}`)
  return executable
}
