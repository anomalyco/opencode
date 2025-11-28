#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@cerebras-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
{
  const name = `${pkg.name}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/cerebras --version`)
  await $`./dist/${name}/bin/cerebras --version`
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./script/postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`

// Filter out problematic windows-x64-baseline package
const filteredBinaries = Object.fromEntries(
  Object.entries(binaries).filter(([name]) => name !== "cerebras-code-windows-x64-baseline"),
)

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: "cerebras-code",
      bin: {
        cerebras: `./bin/cerebras`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: filteredBinaries,
    },
    null,
    2,
  ),
)
// npm publishing (skip if no NPM_TOKEN)
if (process.env.NPM_CONFIG_TOKEN) {
  // Wait 60 seconds before starting to avoid residual rate limiting
  console.log("⏳ Waiting 60 seconds before publishing to avoid rate limits...")
  await new Promise((resolve) => setTimeout(resolve, 60000))
  let count = 0
  for (const [name] of Object.entries(binaries)) {
    // Skip windows-x64-baseline due to npm rate limiting
    if (name === "cerebras-code-windows-x64-baseline") {
      console.log(`⏭️  Skipping ${name} (problematic package)`)
      continue
    }

    try {
      process.chdir(`./dist/${name}`)
      if (process.platform !== "win32") {
        await $`chmod 755 -R .`
      }

      // Retry logic for rate limiting
      let retries = 0
      const maxRetries = 3
      while (retries <= maxRetries) {
        try {
          await $`bun publish --access public --tag ${Script.channel}`
          break // Success, exit retry loop
        } catch (error: any) {
          if (error.stderr?.includes("429") || error.stderr?.includes("rate limited")) {
            retries++
            if (retries > maxRetries) {
              console.log(`❌ Failed to publish ${name} after ${maxRetries} retries`)
              throw error
            }
            const waitTime = Math.pow(2, retries) * 60000 // Exponential backoff: 2min, 4min, 8min
            console.log(`⚠️  Rate limited on ${name}, retry ${retries}/${maxRetries} in ${waitTime / 60000} minutes...`)
            await new Promise((resolve) => setTimeout(resolve, waitTime))
          } else {
            throw error // Not a rate limit error, rethrow
          }
        }
      }

      count++
      // Add delay to avoid npm rate limiting - wait after EACH publish
      console.log(`⏳ Published ${count}/${Object.keys(binaries).length}, pausing for 60 seconds...`)
      await new Promise((resolve) => setTimeout(resolve, 60000))
    } finally {
      process.chdir(dir)
    }
  }
  // Wait 2 minutes before publishing main package to avoid rate limiting
  console.log("⏳ Waiting 2 minutes before publishing main cerebras-code package...")
  await new Promise((resolve) => setTimeout(resolve, 120000))
  await $`cd ./dist/${pkg.name} && bun publish --access public --tag ${Script.channel}`
} else {
  console.log("⚠️  Skipping npm publish (NPM_CONFIG_TOKEN not set)")
}

if (!Script.preview && process.env.NPM_CONFIG_TOKEN) {
  const major = Script.version.split(".")[0]
  const majorTag = `latest-${major}`
  for (const [name] of Object.entries(binaries)) {
    await $`cd dist/${name} && npm dist-tag add ${name}@${Script.version} ${majorTag}`
  }
  await $`cd ./dist/${pkg.name} && npm dist-tag add cerebras-code@${Script.version} ${majorTag}`
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
  const arm64Sha = await $`sha256sum ./dist/cerebras-linux-arm64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const x64Sha = await $`sha256sum ./dist/cerebras-linux-x64.tar.gz | cut -d' ' -f1`.text().then((x) => x.trim())
  const macX64Sha = await $`sha256sum ./dist/cerebras-darwin-x64.zip | cut -d' ' -f1`.text().then((x) => x.trim())
  const macArm64Sha = await $`sha256sum ./dist/cerebras-darwin-arm64.zip | cut -d' ' -f1`.text().then((x) => x.trim())

  const [pkgver, _subver = ""] = Script.version.split(/(-.*)/, 2)

  // arch
  const binaryPkgbuild = [
    "# Maintainer: Arihant Choudhary",
    "# Maintainer: Cerebras",
    "",
    "pkgname='cerebras-bin'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/arihantchoudhary/opencode'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('cerebras')",
    "conflicts=('cerebras')",
    "depends=('fzf' 'ripgrep')",
    "",
    `source_aarch64=("\${pkgname}_\${pkgver}_aarch64.tar.gz::https://github.com/arihantchoudhary/opencode/releases/download/v\${pkgver}\${_subver}/cerebras-linux-arm64.tar.gz")`,
    `sha256sums_aarch64=('${arm64Sha}')`,

    `source_x86_64=("\${pkgname}_\${pkgver}_x86_64.tar.gz::https://github.com/arihantchoudhary/opencode/releases/download/v\${pkgver}\${_subver}/cerebras-linux-x64.tar.gz")`,
    `sha256sums_x86_64=('${x64Sha}')`,
    "",
    "package() {",
    '  install -Dm755 ./cerebras "${pkgdir}/usr/bin/cerebras"',
    "}",
    "",
  ].join("\n")

  // Source-based PKGBUILD for cerebras
  const sourcePkgbuild = [
    "# Maintainer: Arihant Choudhary",
    "# Maintainer: Cerebras",
    "",
    "pkgname='cerebras'",
    `pkgver=${pkgver}`,
    `_subver=${_subver}`,
    "options=('!debug' '!strip')",
    "pkgrel=1",
    "pkgdesc='The AI coding agent built for the terminal.'",
    "url='https://github.com/arihantchoudhary/opencode'",
    "arch=('aarch64' 'x86_64')",
    "license=('MIT')",
    "provides=('cerebras')",
    "conflicts=('cerebras-bin')",
    "depends=('fzf' 'ripgrep')",
    "makedepends=('git' 'bun-bin' 'go')",
    "",
    `source=("cerebras-\${pkgver}.tar.gz::https://github.com/arihantchoudhary/opencode/archive/v\${pkgver}\${_subver}.tar.gz")`,
    `sha256sums=('SKIP')`,
    "",
    "build() {",
    `  cd "opencode-\${pkgver}"`,
    `  bun install`,
    "  cd ./packages/cerebras",
    `  CEREBRAS_CHANNEL=latest CEREBRAS_VERSION=${pkgver} bun run ./script/build.ts --single`,
    "}",
    "",
    "package() {",
    `  cd "opencode-\${pkgver}/packages/cerebras"`,
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
    '  bin="dist/cerebras-linux-${target_arch}${base}${libc}/bin/cerebras"',
    '  if [ ! -f "$bin" ]; then',
    '    printf "unable to find binary for %s%s%s\\n" "$target_arch" "$base" "$libc" >&2',
    "    return 1",
    "  fi",
    '  install -Dm755 "$bin" "${pkgdir}/usr/bin/cerebras"',
    "}",
    "",
  ].join("\n")

  // AUR Publishing (disabled by default - uncomment when you set up AUR packages)
  /*
  for (const [pkg, pkgbuild] of [
    ["cerebras-bin", binaryPkgbuild],
    ["cerebras", sourcePkgbuild],
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
    "# This file was generated by the publish script.",
    "class Cerebras < Formula",
    `  desc "Cerebras Code - AI coding agent built for the terminal."`,
    `  homepage "https://github.com/arihantchoudhary/opencode"`,
    `  version "${Script.version.split("-")[0]}"`,
    "",
    "  on_macos do",
    "    if Hardware::CPU.intel?",
    `      url "https://github.com/arihantchoudhary/opencode/releases/download/v${Script.version}/cerebras-darwin-x64.zip"`,
    `      sha256 "${macX64Sha}"`,
    "",
    "      def install",
    '        bin.install "cerebras"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm?",
    `      url "https://github.com/arihantchoudhary/opencode/releases/download/v${Script.version}/cerebras-darwin-arm64.zip"`,
    `      sha256 "${macArm64Sha}"`,
    "",
    "      def install",
    '        bin.install "cerebras"',
    "      end",
    "    end",
    "  end",
    "",
    "  on_linux do",
    "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/arihantchoudhary/opencode/releases/download/v${Script.version}/cerebras-linux-x64.tar.gz"`,
    `      sha256 "${x64Sha}"`,
    "      def install",
    '        bin.install "cerebras"',
    "      end",
    "    end",
    "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
    `      url "https://github.com/arihantchoudhary/opencode/releases/download/v${Script.version}/cerebras-linux-arm64.tar.gz"`,
    `      sha256 "${arm64Sha}"`,
    "      def install",
    '        bin.install "cerebras"',
    "      end",
    "    end",
    "  end",
    "end",
    "",
    "",
  ].join("\n")

  // Homebrew Publishing
  if (!Script.preview && process.env.GITHUB_TOKEN) {
    await $`rm -rf ./dist/homebrew-tap`
    await $`git clone https://${process.env["GITHUB_TOKEN"]}@github.com/arihantchoudhary/homebrew-tap.git ./dist/homebrew-tap`
    await Bun.file("./dist/homebrew-tap/cerebras.rb").write(homebrewFormula)
    await $`cd ./dist/homebrew-tap && git add cerebras.rb`
    await $`cd ./dist/homebrew-tap && git commit -m "Update to v${Script.version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }

  const image = "ghcr.io/arihantchoudhary/opencode"
  await $`docker build -t ${image}:${Script.version} .`
  await $`docker push ${image}:${Script.version}`
  await $`docker tag ${image}:${Script.version} ${image}:latest`
  await $`docker push ${image}:latest`
}
