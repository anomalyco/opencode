#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"

const version = process.env["LASH_VERSION"] || process.env["OPENCODE_VERSION"] || pkg.version
const dry = process.env["DRY_RUN"] === "true"

console.log(`🚀 Publishing lash-cli v${version}`)
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
  await $`CGO_ENABLED=0 GOOS=${os} GOARCH=${GOARCH[arch]} go build -ldflags="-s -w -X main.Version=${version}" -o ../opencode/dist/${name}/bin/tui ../tui/cmd/opencode/main.go`.cwd(
    "../tui",
  )
  
  // Build lash binary
  await $`bun build --define OPENCODE_TUI_PATH="'../../../dist/${name}/bin/tui'" --define OPENCODE_VERSION="'${version}'" --compile --target=bun-${os}-${arch} --outfile=dist/${name}/bin/lash ./src/index.ts`
  
  // Run smoke test on current platform
  if (
    process.platform === (os === "windows" ? "win32" : os) &&
    (process.arch === arch || (process.arch === "x64" && arch === "x64-baseline"))
  ) {
    console.log(`✓ Smoke test: running dist/${name}/bin/lash --version`)
    await $`./dist/${name}/bin/lash --version`
  }
  
  // Clean up TUI binary (embedded in lash binary)
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
    await $`cd dist/${name} && chmod -R 755 . && npm publish --access public`
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
const { execSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

const platform = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'x64' ? 'x64' : process.arch;
const packageName = \`lash-cli-\${platform}-\${arch}\`;

console.log(\`Installing \${packageName}...\`);

try {
  // Check if the platform-specific package exists
  const binPath = join(__dirname, 'node_modules', packageName, 'bin', platform === 'windows' ? 'lash.exe' : 'lash');
  if (!existsSync(binPath)) {
    console.error(\`Platform package \${packageName} not found. You may need to install it manually.\`);
    process.exit(1);
  }
  console.log('✓ Lash CLI installed successfully');
} catch (error) {
  console.error('Failed to install platform-specific binary:', error);
  process.exit(1);
}
`

await Bun.file(`./dist/lash-cli/postinstall.mjs`).write(postinstallScript)

// Create main package.json
await Bun.file(`./dist/lash-cli/package.json`).write(
  JSON.stringify(
    {
      name: "lash-cli",
      version,
      description: "The AI coding agent built for the terminal",
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
  await $`cd ./dist/lash-cli && npm publish --access public`
}

console.log(`✨ Lash CLI v${version} published successfully!`)

// Create zip files for GitHub releases
if (!dry) {
  console.log("📦 Creating zip files for GitHub release")
  for (const [os, arch] of targets) {
    const name = `lash-cli-${os}-${arch}`
    await $`cd dist/${name}/bin && zip -r ../../${name}.zip *`
  }
  
  // Output SHA checksums
  console.log("\n📋 SHA256 Checksums:")
  for (const [os, arch] of targets) {
    const name = `lash-cli-${os}-${arch}`
    if (await Bun.file(`./dist/${name}.zip`).exists()) {
      const sha = await $`sha256sum ./dist/${name}.zip | cut -d' ' -f1`.text().then((x) => x.trim())
      console.log(`${name}: ${sha}`)
    }
  }
}