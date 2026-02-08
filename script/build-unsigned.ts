#!/usr/bin/env bun

/**
 * Build unsigned Claxedo desktop app for local distribution
 *
 * This script:
 * 1. Applies Claxedo patches to OpenCode
 * 2. Builds the patched CLI
 * 3. Builds the Claxedo frontend
 * 4. Builds the desktop app with Tauri (unsigned)
 */

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const patchesDir = path.join(root, "packages/claxedo-app/src/opencode-patches")
const targetDir = path.join(root, "packages/opencode/src")

console.log("🚀 Building unsigned Claxedo desktop app\n")

// Step 1: Apply patches
console.log("📝 Step 1: Applying Claxedo patches to OpenCode...")
try {
  await $`find ${patchesDir} -type f -name "*.ts"`.quiet()
  const patches = await $`find ${patchesDir} -type f -name "*.ts"`.text()

  for (const patch of patches.trim().split("\n").filter(Boolean)) {
    const relPath = patch.substring(patchesDir.length + 1)
    const target = path.join(targetDir, relPath)
    const targetDirPath = path.join(target, "..")

    await $`mkdir -p ${targetDirPath}`.quiet()
    await $`cp ${patch} ${target}`.quiet()
    console.log(`  ✓ Patched: ${relPath}`)
  }
  console.log("✅ Patches applied\n")
} catch (error) {
  console.error("❌ Failed to apply patches:", error)
  process.exit(1)
}

// Step 2: Build CLI
console.log("🔨 Step 2: Building patched OpenCode CLI...")
try {
  await $`cd ${path.join(root, "packages/opencode")} && ./script/build.ts`.env({
    ...process.env,
    OPENCODE_VERSION: process.env.OPENCODE_VERSION || "dev",
  })
  console.log("✅ CLI built\n")
} catch (error) {
  console.error("❌ CLI build failed:", error)
  // Restore files before exiting
  await $`cd ${path.join(root, "packages/opencode")} && git checkout -- src/`.quiet()
  process.exit(1)
}

// Step 3: Restore OpenCode source
console.log("🔄 Step 3: Restoring original OpenCode source...")
try {
  await $`cd ${path.join(root, "packages/opencode")} && git checkout -- src/`.quiet()
  console.log("✅ Source restored\n")
} catch (error) {
  console.error("⚠️  Warning: Could not restore original source:", error)
}

// Step 4: Setup CLI sidecar
console.log("📦 Step 4: Setting up CLI sidecar...")
try {
  const desktopDir = path.join(root, "packages/desktop")
  const sidecarsDir = path.join(desktopDir, "src-tauri/sidecars")

  await $`mkdir -p ${sidecarsDir}`.quiet()

  // Detect platform
  const platform = process.platform
  const arch = process.arch

  let cliBinary: string = ""
  let sidecarName: string = ""

  if (platform === "darwin") {
    if (arch === "arm64") {
      cliBinary = "opencode-darwin-arm64"
      sidecarName = "opencode-cli-aarch64-apple-darwin"
    } else {
      cliBinary = "opencode-darwin-x64"
      sidecarName = "opencode-cli-x86_64-apple-darwin"
    }
  } else if (platform === "win32") {
    cliBinary = "opencode-windows-x64"
    sidecarName = "opencode-cli-x86_64-pc-windows-msvc.exe"
  } else if (platform === "linux") {
    cliBinary = "opencode-linux-x64"
    sidecarName = "opencode-cli-x86_64-unknown-linux-gnu"
  } else {
    console.error(`❌ Unsupported platform: ${platform}`)
    process.exit(1)
  }

  const cliSource = path.join(
    root,
    `packages/opencode/dist/${cliBinary}/bin/opencode${platform === "win32" ? ".exe" : ""}`,
  )
  const cliTarget = path.join(sidecarsDir, sidecarName)

  await $`cp ${cliSource} ${cliTarget}`.quiet()
  await $`chmod +x ${cliTarget}`.quiet()

  console.log(`  ✓ Copied ${cliBinary} to ${sidecarName}`)
  console.log("✅ Sidecar ready\n")
} catch (error) {
  console.error("❌ Failed to setup sidecar:", error)
  process.exit(1)
}

// Step 5: Build frontend
console.log("🎨 Step 5: Building Claxedo frontend...")
try {
  await $`cd ${path.join(root, "packages/claxedo-app")} && bunx vite build --config vite.desktop.config.ts`
  console.log("✅ Frontend built\n")
} catch (error) {
  console.error("❌ Frontend build failed:", error)
  process.exit(1)
}

// Step 6: Create Tauri config override
console.log("⚙️  Step 6: Creating Tauri config...")
try {
  const desktopDir = path.join(root, "packages/desktop")
  const configPath = path.join(desktopDir, "src-tauri/tauri.claxedo.override.json")

  const config = {
    build: {
      beforeBuildCommand: "",
      frontendDist: "../../claxedo-app/dist-desktop",
    },
    productName: "Claxedo",
    identifier: "ai.claxedo.desktop",
    bundle: {
      createUpdaterArtifacts: false, // Disable updater for unsigned builds
    },
  }

  await Bun.write(configPath, JSON.stringify(config, null, 2))
  console.log("✅ Config created\n")
} catch (error) {
  console.error("❌ Failed to create config:", error)
  process.exit(1)
}

// Step 7: Build Tauri app
console.log("🏗️  Step 7: Building Tauri app (this may take a while)...")
console.log("⚠️  Note: Code signing warnings are expected for unsigned builds\n")
try {
  const desktopDir = path.join(root, "packages/desktop")

  await $`cd ${desktopDir} && bun run tauri build --config src-tauri/tauri.claxedo.override.json`.env({
    ...process.env,
    TAURI_SKIP_SIGNING: "1", // Skip signing checks
  })

  console.log("\n✅ Build complete!\n")
} catch (error) {
  // Tauri may exit with error due to signing issues, but build might still succeed
  console.log("\n⚠️  Build process completed with warnings (expected for unsigned builds)")
}

// Step 8: Show output location
console.log("📍 Build artifacts location:")
console.log("   packages/desktop/src-tauri/target/release/bundle/\n")

console.log("📖 Next steps:")
console.log("   1. Find your installer in the bundle directory above")
console.log("   2. Share with users along with installation instructions")
console.log("   3. See BUILD_UNSIGNED.md for user installation guide\n")

console.log("💡 Tip: Users on macOS will need to right-click → Open to bypass Gatekeeper")
