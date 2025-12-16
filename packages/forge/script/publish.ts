#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@forge/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  const name = `${pkg.name}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/forge --version`)
  await $`./dist/${name}/bin/forge --version`
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: "@forge-agents/forge",
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)
for (const [name] of Object.entries(binaries)) {
  try {
    process.chdir(`./dist/${name}`)
    if (process.platform !== "win32") {
      await $`chmod -R 755 .`
    }
    await $`bun publish --access public --tag ${Script.channel}`
  } finally {
    process.chdir(dir)
  }
}
await $`cd ./dist/${pkg.name} && bun publish --access public --tag ${Script.channel}`

if (!Script.preview) {
  const major = Script.version.split(".")[0]
  const majorTag = `latest-${major}`
  for (const [name] of Object.entries(binaries)) {
    await $`cd dist/${name} && npm dist-tag add ${name}@${Script.version} ${majorTag}`
  }
  await $`cd ./dist/${pkg.name} && npm dist-tag add @forge-agents/forge@${Script.version} ${majorTag}`
}

if (!Script.preview) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`cd dist/${key}/bin && tar -czf ../../${key}.tar.gz *`
    } else {
      await $`cd dist/${key}/bin && zip -r ../../${key}.zip *`
    }
  }

  // Calculate SHA values
  const arm64Sha = await $`sha256sum ./dist/forge-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/forge-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/forge-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/forge-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // AUR Publishing - Commented out (not using AUR for Forge)
  /*
  // arch
  const binaryPkgbuild = [
    "# Maintainer: forge",
    "",
    "pkgname='forge-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='Universal CLI for ACP agents'",
    "url='https://github.com/forge-agents/forge'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('forge')",
    "conflicts=('forge')",
    "depends=('fzf' 'ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/forge-agents/forge/releases/download/v\${pkgver}\${_subver}/forge-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/forge-agents/forge/releases/download/v\${pkgver}\${_subver}/forge-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./forge "${pkgdir}/usr/bin/forge"',
    "}",
    "",
  ].join("\n")

  // Source-based PKGBUILD for forge
  const sourcePkgbuild = [
    "# Maintainer: forge",
    "",
    "pkgname='forge'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='Universal CLI for ACP agents'",
    "url='https://github.com/forge-agents/forge'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('forge')",
    "conflicts=('forge-bin')",
    "depends=('fzf' 'ripgrep')",
    "makedepends=('git' 'bun-bin')",
    "",
    `source=("forge-\${pkgver}.tar.gz::https://github.com/forge-agents/forge/archive/v\${pkgver}\${_subver}.tar.gz")`,
    `sha256sums=('SKIP')`,
    "",
    "build() {",
    `  cd "forge-\${pkgver}"`,
    `  bun install`,
    "  cd ./packages/forge",
    `  FORGE_CHANNEL=latest FORGE_VERSION=${pkgver} bun run ./script/build.ts --single`,
    "}",
    "",
    "package() {",
    `  cd "forge-\${pkgver}/packages/forge"`,
    '  mkdir -p "${pkgdir}/usr/bin"',
    '  target_arch="x64"',
    '  case "$CARCH" in',
    '    x86_64) target_arch="x64" ;;',
    '    aarch64) target_arch="arm64" ;;',
    '    *) printf "unsupported architecture: %s\\n" "$CARCH" >&2 ; return 1 ;;',
    "  esac",
    '  libc=""',
    "  if command -v ldd >/dev/null 2>&1; then",
    "    if ldd --version 2>&1 | grep -qi musl; then",
    '      libc="-musl"',
    "    fi",
    "  fi",
    '  if [ -z "$libc" ] && ls /lib/ld-musl-* >/dev/null 2>&1; then',
    '    libc="-musl"',
    "  fi",
    '  base=""',
    '  if [ "$target_arch" = "x64" ]; then',
    "    if ! grep -qi avx2 /proc/cpuinfo 2>/dev/null; then",
    '      base="-baseline"',
    "    fi",
    "  fi",
    '  bin="dist/forge-linux-${target_arch}${base}${libc}/bin/forge"',
    '  if [ ! -f "$bin" ]; then',
    '    printf "unable to find binary for %s%s%s\\n" "$target_arch" "$base" "$libc" >&2',
    "    return 1",
    "  fi",
    '  install -Dm755 "$bin" "${pkgdir}/usr/bin/forge"',
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [
    ["forge-bin", binaryPkgbuild],
    ["forge", sourcePkgbuild],
  ]) {
    for (let i = 0; i < 30; i++) {
      try {
        await $`rm -rf ./dist/aur-${pkg}`
        await $`git clone ssh://aur@aur.archlinux.org/${pkg}.git ./dist/aur-${pkg}`
        await $`cd ./dist/aur-${pkg} && git checkout master`
        await Bun.file(`./dist/aur-${pkg}/PKGBUILD`).write(pkgbuild)
        await $`cd ./dist/aur-${pkg} && makepkg --printsrcinfo > .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git add PKGBUILD .SRCINFO`
        await $`cd ./dist/aur-${pkg} && git commit -m "Update to v${Script.version}"`
        await $`cd ./dist/aur-${pkg} && git push`
        break
      } catch (e) {
        continue
      }
    }
  }
  */

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was auto-generated. DO NOT EDIT.",
    "class Forge < Formula",
    `  desc "Universal CLI for ACP agents"`,
    `  homepage "https://github.com/forge-agents/forge"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/forge-agents/forge/releases/download/v${Script.version}/forge-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "forge"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/forge-agents/forge/releases/download/v${Script.version}/forge-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "forge"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/forge-agents/forge/releases/download/v${Script.version}/forge-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "forge"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/forge-agents/forge/releases/download/v${Script.version}/forge-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "forge"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone https://${process.env["GITHUB_TOKEN"]}@github.com/forge-agents/homebrew-tap.git ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/forge.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add forge.rb`
  await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
  await $`cd ./dist/homebrew-tap && git push`
}
