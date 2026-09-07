#!/usr/bin/env bun
import { Script } from "@opencode/script"
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

if (Script.channel !== "beta") throw new Error("AUR publishing requires the beta channel")
if (!/^0\.0\.0-beta-\d+(?:\.\d+)?$/.test(Script.version)) throw new Error("Expected a beta release version")

const response = await fetch("https://update.opencode.ai/api/beta/cli/npm")
if (!response.ok) throw new Error(`Failed to resolve the beta release: ${response.status}`)
const release: { version: string; metadata?: { package?: string } } = await response.json()
if (release.version !== Script.version) throw new Error(`The active beta release is ${release.version}`)
if (release.metadata?.package !== "@opencode/cli" && release.metadata?.package !== "@opencode-ai/cli") {
  throw new Error("The beta release did not identify a supported CLI package")
}

const dir = fileURLToPath(new URL("..", import.meta.url))
const outdir = path.join(dir, "dist", "aur-opencode-beta")
const dryRun = process.argv.includes("--dry-run")
const pkgver = Script.version.replaceAll("-", ".")
const scope = release.metadata.package.slice(0, -"/cli".length)
const license = Bun.file(path.join(dir, "..", "..", "LICENSE"))

await rm(outdir, { recursive: true, force: true })
await mkdir(path.dirname(outdir), { recursive: true })
if (dryRun) await mkdir(outdir)
if (!dryRun) {
  await $`git clone ssh://aur@aur.archlinux.org/opencode-beta.git ${outdir}`
  await $`git checkout -B master`.cwd(outdir)
}

const sources = await Promise.all(
  [
    { arch: "x86_64", target: "linux-x64-baseline" },
    { arch: "aarch64", target: "linux-arm64" },
  ].map(async (item) => {
    const filename = `opencode-beta-${pkgver}-${item.arch}.tgz`
    const url = `https://registry.npmjs.org/${scope}/cli-${item.target}/-/cli-${item.target}-${Script.version}.tgz`
    await $`curl --fail --location --retry 5 --retry-all-errors --output ${path.join(outdir, filename)} ${url}`
    const sha256 = new Bun.CryptoHasher("sha256")
      .update(await Bun.file(path.join(outdir, filename)).arrayBuffer())
      .digest("hex")
    return [`source_${item.arch}=('${filename}::${url}')`, `sha256sums_${item.arch}=('${sha256}')`].join("\n")
  }),
)

await Bun.write(path.join(outdir, "LICENSE"), license)
await Bun.write(
  path.join(outdir, "PKGBUILD"),
  [
    "# Maintainer: Dax <mail@thdxr.com>",
    "pkgname=opencode-beta",
    `pkgver=${pkgver}`,
    "pkgrel=1",
    "pkgdesc='OpenCode V2 beta - the AI coding agent for the terminal'",
    "url='https://github.com/anomalyco/opencode'",
    "arch=('x86_64' 'aarch64')",
    "license=('MIT')",
    "depends=('glibc' 'gcc-libs' 'ripgrep')",
    "provides=('opencode2')",
    "conflicts=('opencode2')",
    // Stripping a compiled Bun executable can damage its embedded application.
    "options=('!strip' '!debug')",
    "source=('LICENSE')",
    `sha256sums=('${new Bun.CryptoHasher("sha256").update(await license.arrayBuffer()).digest("hex")}')`,
    ...sources,
    "",
    "package() {",
    '  install -Dm755 "$srcdir/package/bin/opencode2" "$pkgdir/usr/bin/opencode2"',
    '  install -Dm644 "$srcdir/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"',
    "}",
    "",
  ].join("\n"),
)
await Bun.write(path.join(outdir, ".SRCINFO"), await $`makepkg --printsrcinfo`.cwd(outdir).text())
console.log(`Prepared opencode-beta ${pkgver} in ${outdir}`)
if (dryRun) process.exit(0)

await $`git add PKGBUILD .SRCINFO LICENSE`.cwd(outdir)
if ((await $`git diff --cached --quiet`.cwd(outdir).nothrow()).exitCode === 0) {
  console.log("AUR package is already up to date")
  process.exit(0)
}
await $`git commit -m ${`chore: update opencode-beta to ${pkgver}`}`.cwd(outdir)
await $`git push origin master`.cwd(outdir)
