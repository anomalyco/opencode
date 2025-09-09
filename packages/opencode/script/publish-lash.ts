#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"

const version = process.env["LASH_VERSION"] || process.env["OPENCODE_VERSION"] || pkg.version
const dry = process.env["DRY_RUN"] === "true"
const otp = process.env["NPM_OTP"] || ""

console.log(`🚀 Publishing lash v${version}`)
if (dry) console.log("(DRY RUN - no actual publishing)")

const GOARCH: Record<string, string> = {
  arm64: "arm64",
  x64: "amd64",
  "x64-baseline": "amd64",
}

const targets = [
  ["windows", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["linux", "x64-baseline"],
  ["darwin", "x64"],
  ["darwin", "x64-baseline"],
  ["darwin", "arm64"],
]

// Clean dist directory
await $`rm -rf dist/lash-*`

const optionalDependencies: Record<string, string> = {}

// Build for each target platform
for (const [os, arch] of targets) {
  const name = `lash-cli-${os}-${arch}`
  console.log(`📦 Building ${name}`)
  
  await $`mkdir -p dist/${name}/bin`
  
  // Build TUI component
  await $`CGO_ENABLED=0 GOOS=${os} GOARCH=${GOARCH[arch]} go build -ldflags="-s -w -X main.Version=${version}" -o ../opencode/dist/${name}/bin/tui ./cmd/opencode/main.go`.cwd(
    "../tui",
  )
  
  // Build lash binary with embedded TUI
  await $`bun build --define OPENCODE_TUI_PATH="'../../../dist/${name}/bin/tui'" --define OPENCODE_VERSION="'${version}'" --compile --target=bun-${os}-${arch} --outfile=dist/${name}/bin/lash ./src/index.ts --embed ./dist/${name}/bin/tui`
  
  // Run smoke test on current platform
  if (
    process.platform === (os === "windows" ? "win32" : os) &&
    (process.arch === arch || (process.arch === "x64" && arch === "x64-baseline"))
  ) {
    console.log(`✓ Smoke test: running dist/${name}/bin/lash --version`)
    await $`./dist/${name}/bin/lash --version`
    console.log(`✓ Smoke test: checking TUI binary is embedded`)
    await $`./dist/${name}/bin/lash --help | head -5`
  }
  
  // Clean up TUI binary (now embedded in lash binary)
  await $`rm -rf ./dist/${name}/bin/tui`
  
  // Create package.json for platform-specific package
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version,
        os: [os === "windows" ? "win32" : os],
        cpu: [arch],
        bin: {
          lash: os === "windows" ? "./bin/lash.exe" : "./bin/lash"
        }
      },
      null,
      2,
    ),
  )
  
  // Publish platform-specific package
  if (!dry) {
    if (otp) {
      await $`cd dist/${name} && chmod -R 755 . && npm publish --access public --otp=${otp}`
    } else {
      await $`cd dist/${name} && chmod -R 755 . && npm publish --access public`
    }
  }
  
  optionalDependencies[name] = version
}

// Create main lash-cli package
console.log("📦 Creating main lash-cli package")
await $`mkdir -p ./dist/lash-cli/bin`

// Create wrapper script for Unix systems
const unixWrapper = `#!/bin/sh
set -e

if [ -n "$LASH_BIN_PATH" ]; then
    resolved="$LASH_BIN_PATH"
else
    # Get the real path of this script, resolving any symlinks
    script_path="$0"
    while [ -L "$script_path" ]; do
        link_target="$(readlink "$script_path")"
        case "$link_target" in
            /*) script_path="$link_target" ;;
            *) script_path="$(dirname "$script_path")/$link_target" ;;
        esac
    done
    script_dir="$(dirname "$script_path")"
    script_dir="$(cd "$script_dir" && pwd)"
    
    # Map platform names
    case "$(uname -s)" in
        Darwin) platform="darwin" ;;
        Linux) platform="linux" ;;
        MINGW*|CYGWIN*|MSYS*) platform="win32" ;;
        *) platform="$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
    esac
    
    # Map architecture names  
    case "$(uname -m)" in
        x86_64|amd64) arch="x64" ;;
        aarch64) arch="arm64" ;;
        armv7l) arch="arm" ;;
        *) arch="$(uname -m)" ;;
    esac
    
    name="lash-cli-\${platform}-\${arch}"
    binary="lash"
    [ "$platform" = "win32" ] && binary="lash.exe"
    
    # Search for the binary starting from real script location
    resolved=""
    current_dir="$script_dir"
    while [ "$current_dir" != "/" ]; do
        candidate="$current_dir/node_modules/$name/bin/$binary"
        if [ -f "$candidate" ]; then
            resolved="$candidate"
            break
        fi
        current_dir="$(dirname "$current_dir")"
    done
    
    if [ -z "$resolved" ]; then
        printf "It seems that your package manager failed to install the right version of the lash CLI for your platform. You can try manually installing the \\"%s\\" package\\n" "$name" >&2
        exit 1
    fi
fi

# Handle SIGINT gracefully
trap '' INT

# Execute the binary with all arguments
exec "$resolved" "$@"
`

await Bun.file(`./dist/lash-cli/bin/lash`).write(unixWrapper)
await $`chmod +x ./dist/lash-cli/bin/lash`

// Create Windows wrapper
const windowsWrapper = `@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe" "%~dp0\\..\\node_modules\\lash-cli-windows-x64\\bin\\lash.exe" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node "%~dp0\\..\\node_modules\\lash-cli-windows-x64\\bin\\lash.exe" %*
)`

await Bun.file(`./dist/lash-cli/bin/lash.cmd`).write(windowsWrapper)

// Create postinstall script
const postinstallScript = `#!/usr/bin/env node
const { existsSync } = require('fs');
const { join } = require('path');

const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
const arch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch;
const packageName = \`lash-cli-\${platform}-\${arch}\`;

console.log(\`Checking for platform-specific package: \${packageName}\`);

// The platform-specific package should be installed as an optional dependency
// We just need to verify it exists
const searchPaths = [
  join(__dirname, '..', packageName, 'bin', platform === 'windows' ? 'lash.exe' : 'lash'),
  join(__dirname, '..', '..', packageName, 'bin', platform === 'windows' ? 'lash.exe' : 'lash'),
  join(__dirname, 'node_modules', packageName, 'bin', platform === 'windows' ? 'lash.exe' : 'lash')
];

let found = false;
for (const path of searchPaths) {
  if (existsSync(path)) {
    console.log(\`✓ Found platform binary at: \${path}\`);
    found = true;
    break;
  }
}

if (!found) {
  console.log(\`Platform package \${packageName} will be installed as an optional dependency.\`);
  console.log('If installation fails, you can manually install it with:');
  console.log(\`  npm install \${packageName}\`);
}
`

await Bun.file(`./dist/lash-cli/postinstall.mjs`).write(postinstallScript)

// Create main package.json
await Bun.file(`./dist/lash-cli/package.json`).write(
  JSON.stringify(
    {
      name: "lash-cli",
      version,
      description: "lash - The AI coding agent built for the terminal",
      bin: {
        lash: "./bin/lash"
      },
      scripts: {
        postinstall: "node ./postinstall.mjs"
      },
      keywords: ["ai", "cli", "coding", "assistant", "terminal", "lash"],
      author: "",
      license: "MIT",
      repository: {
        type: "git",
        url: "https://github.com/lacymorrow/opencode"
      },
      optionalDependencies,
      engines: {
        node: ">=18.0.0"
      }
    },
    null,
    2,
  ),
)

// Publish main package
if (!dry) {
  if (otp) {
    await $`cd ./dist/lash-cli && npm publish --access public --otp=${otp}`
  } else {
    await $`cd ./dist/lash-cli && npm publish --access public`
  }
}

console.log(`✨ lash v${version} published successfully!`)

// Create zip files for GitHub releases and compute checksums
if (!dry) {
  console.log("📦 Creating zip files for GitHub release")
  for (const [os, arch] of targets) {
    const name = `lash-cli-${os}-${arch}`
    await $`cd dist/${name}/bin && zip -r ../../${name}.zip *`
  }

  // Compute SHA256 checksums (use shasum for macOS compatibility)
  const shaOf = async (path: string) =>
    await $`shasum -a 256 ${path} | cut -d' ' -f1`.text().then((x) => x.trim())

  const linuxArm64Zip = `./dist/lash-cli-linux-arm64.zip`
  const linuxX64Zip = `./dist/lash-cli-linux-x64.zip`
  const darwinX64Zip = `./dist/lash-cli-darwin-x64.zip`
  const darwinArm64Zip = `./dist/lash-cli-darwin-arm64.zip`

  const arm64Sha = (await Bun.file(linuxArm64Zip).exists()) ? await shaOf(linuxArm64Zip) : ""
  const x64Sha = (await Bun.file(linuxX64Zip).exists()) ? await shaOf(linuxX64Zip) : ""
  const macX64Sha = (await Bun.file(darwinX64Zip).exists()) ? await shaOf(darwinX64Zip) : ""
  const macArm64Sha = (await Bun.file(darwinArm64Zip).exists()) ? await shaOf(darwinArm64Zip) : ""

  console.log("\n📋 SHA256 Checksums:")
  if (arm64Sha) console.log(`lash-cli-linux-arm64: ${arm64Sha}`)
  if (x64Sha) console.log(`lash-cli-linux-x64: ${x64Sha}`)
  if (macX64Sha) console.log(`lash-cli-darwin-x64: ${macX64Sha}`)
  if (macArm64Sha) console.log(`lash-cli-darwin-arm64: ${macArm64Sha}`)

  // Create Homebrew formula and push to tap if GITHUB_TOKEN is available
  const tapToken = process.env["GITHUB_TOKEN"]
  if (tapToken) {
    const shortVersion = version.split("-")[0]
    const homebrewFormula = [
      "# typed: false",
      "# frozen_string_literal: true",
      "",
      "# Generated by publish-lash.ts",
      "class Lash < Formula",
      `  desc "The AI coding agent built for the terminal."`,
      `  homepage "https://github.com/lacymorrow/lash"`,
      `  version "${shortVersion}"`,
      "",
      "  on_macos do",
      "    if Hardware::CPU.intel?",
      `      url "https://github.com/lacymorrow/lash/releases/download/v${version}/lash-cli-darwin-x64.zip"`,
      macX64Sha ? `      sha256 "${macX64Sha}"` : "      sha256 :no_check",
      "",
      "      def install",
      '        bin.install "lash"',
      "      end",
      "    end",
      "    if Hardware::CPU.arm?",
      `      url "https://github.com/lacymorrow/lash/releases/download/v${version}/lash-cli-darwin-arm64.zip"`,
      macArm64Sha ? `      sha256 "${macArm64Sha}"` : "      sha256 :no_check",
      "",
      "      def install",
      '        bin.install "lash"',
      "      end",
      "    end",
      "  end",
      "",
      "  on_linux do",
      "    if Hardware::CPU.intel? and Hardware::CPU.is_64_bit?",
      `      url "https://github.com/lacymorrow/lash/releases/download/v${version}/lash-cli-linux-x64.zip"`,
      x64Sha ? `      sha256 "${x64Sha}"` : "      sha256 :no_check",
      "      def install",
      '        bin.install "lash"',
      "      end",
      "    end",
      "    if Hardware::CPU.arm? and Hardware::CPU.is_64_bit?",
      `      url "https://github.com/lacymorrow/lash/releases/download/v${version}/lash-cli-linux-arm64.zip"`,
      arm64Sha ? `      sha256 "${arm64Sha}"` : "      sha256 :no_check",
      "      def install",
      '        bin.install "lash"',
      "      end",
      "    end",
      "  end",
      "end",
      "",
    ].join("\n")

    await $`rm -rf ./dist/homebrew-tap`
    await $`git clone https://${tapToken}@github.com/lacymorrow/homebrew-tap.git ./dist/homebrew-tap`
    await Bun.file("./dist/homebrew-tap/lash.rb").write(homebrewFormula)
    await $`cd ./dist/homebrew-tap && git add lash.rb`
    await $`cd ./dist/homebrew-tap && git commit -m "Update lash to v${version}"`
    await $`cd ./dist/homebrew-tap && git push`
  }

  // Create GitHub release and upload assets if GITHUB_TOKEN is available
  const ghToken = process.env["GITHUB_TOKEN"]
  if (ghToken) {
    const owner = "lacymorrow"
    const repo = "lash"
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: "POST",
      headers: {
        Authorization: `token ${ghToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        tag_name: `v${version}`,
        name: `v${version}`,
        draft: false,
        prerelease: version.includes("-")
      })
    })

    if (res.ok) {
      const json = await res.json()
      const releaseId = json.id as number
      const upload = async (filePath: string, name: string) => {
        if (!await Bun.file(filePath).exists()) return
        const buf = await Bun.file(filePath).arrayBuffer()
        const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`
        await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `token ${ghToken}`,
            "Content-Type": "application/zip",
            Accept: "application/vnd.github+json",
          },
          body: buf,
        })
      }

      await upload(linuxArm64Zip, "lash-cli-linux-arm64.zip")
      await upload(linuxX64Zip, "lash-cli-linux-x64.zip")
      await upload(darwinX64Zip, "lash-cli-darwin-x64.zip")
      await upload(darwinArm64Zip, "lash-cli-darwin-arm64.zip")
    }
  }
}