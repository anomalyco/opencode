#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  const name = `${pkg.name}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/opencode --version`)
  await $`./dist/${name}/bin/opencode --version`
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/preinstall.mjs ./dist/${pkg.name}/preinstall.mjs`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name + "-ai",
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        preinstall: "node ./preinstall.mjs",
        postinstall: "node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)
for (const [name] of Object.entries(binaries)) {
  await $`cd dist/${name} && chmod 777 -R . && bun publish --access public --tag ${Script.channel}`
}
await $`cd ./dist/${pkg.name} && bun publish --access public --tag ${Script.channel}`

if (!Script.preview) {
  const major = Script.version.split(".")[0]
  const majorTag = `v${major}`
  for (const [name] of Object.entries(binaries)) {
    await $`cd dist/${name} && npm dist-tag add ${name}@${Script.version} ${majorTag}`
  }
  await $`cd ./dist/${pkg.name} && npm dist-tag add ${pkg.name}-ai@${Script.version} ${majorTag}`
}

if (!Script.preview) {
  for (const key of Object.keys(binaries)) {
    await $`cd dist/${key}/bin && zip -r ../../${key}.zip *`
  }

  // Calculate SHA values
  const arm64Sha = await $`sha256sum ./dist/opencode-linux-arm64.zip | cut -d' ' -f1`
    .text()
    .then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/opencode-linux-x64.zip | cut -d' ' -f1`
    .text()
    .then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/opencode-darwin-x64.zip | cut -d' ' -f1`
    .text()
    .then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/opencode-darwin-arm64.zip | cut -d' ' -f1`
    .text()
    .then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='opencode-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/sst/opencode'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('opencode')",
    "conflicts=('opencode')",
    "depends=('fzf' 'ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.zip::https://github.com/sst/opencode/releases/download/v\${pkgver}\${_subver}/opencode-linux-arm64.zip")`,
    `sha256sums_aarch64=('${arm64Sha}')`,
    "",
    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.zip::https://github.com/sst/opencode/releases/download/v\${pkgver}\${_subver}/opencode-linux-x64.zip")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./opencode "${pkgdir}/usr/bin/opencode"',
    "}",
    "",
  ].join("\n")

  // Source-based PKGBUILD for opencode
  const sourcePkgbuild = [
    "# Maintainer: dax",
    "# Maintainer: adam",
    "",
    "pkgname='opencode'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/sst/opencode'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('opencode')",
    "conflicts=('opencode-bin')",
    "depends=('fzf' 'ripgrep')",
    "makedepends=('git' 'bun-bin' 'go')",
    "",
    `source=("opencode-\${pkgver}.tar.gz::https://github.com/sst/opencode/archive/v\${pkgver}\${_subver}.tar.gz")`,
    `sha256sums=('SKIP')`,
    "",
    "build() {",
    `  cd "opencode-\${pkgver}"`,
    `  bun install`,
    "  cd packages/tui",
    `  CGO_ENABLED=0 go build -ldflags="-s -w -X main.Version=\${pkgver}" -o tui cmd/opencode/main.go`,
    "  cd ../opencode",
    `  bun build --define OPENCODE_TUI_PATH="'$(realpath ../tui/tui)'" --define OPENCODE_VERSION="'\${pkgver}'" --compile --target=bun-linux-x64 --outfile=opencode ./src/index.ts`,
    "}",
    "",
    "package() {",
    `  cd "opencode-\${pkgver}/packages/opencode"`,
    '  install -Dm755 ./opencode "${pkgdir}/usr/bin/opencode"',
    "}",
    "",
  ].join("\n")

  for (const [pkg, pkgbuild] of [
    ["opencode-bin", binaryPkgbuild],
    ["opencode", sourcePkgbuild],
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

  // Homebrew formula
  const homebrewFormula = [
    "# typed: false",
    "# frozen_string_literal: true",
    "",
    "# This file was generated by GoReleaser. DO NOT EDIT.",
    "class Opencode < Formula",
    `  desc "The AI coding agent built for the terminal."`,
    `  homepage "https://github.com/sst/opencode"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/sst/opencode/releases/download/v${Script.version}/opencode-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "opencode"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/sst/opencode/releases/download/v${Script.version}/opencode-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "opencode"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/sst/opencode/releases/download/v${Script.version}/opencode-linux-x64.zip"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "opencode"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/sst/opencode/releases/download/v${Script.version}/opencode-linux-arm64.zip"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "opencode"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  await $`rm -rf ./dist/homebrew-tap`
  await $`git clone https://${process.env["GITHUB_TOKEN"]}@github.com/sst/homebrew-tap.git ./dist/homebrew-tap`
  await Bun.file("./dist/homebrew-tap/opencode.rb").write(homebrewFormula)
  await $`cd ./dist/homebrew-tap && git add opencode.rb`
  await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
  await $`cd ./dist/homebrew-tap && git push`
}
