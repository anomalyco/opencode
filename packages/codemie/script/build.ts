#!/usr/bin/env bun

import path from "path"
import fs from "fs"
import { $ } from "bun"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const opencodePkgDir = path.resolve(dir, "../opencode")

process.chdir(dir)

// Forward flags to the opencode build
const flags: string[] = []
if (process.argv.includes("--single")) flags.push("--single")
if (process.argv.includes("--baseline")) flags.push("--baseline")
if (process.argv.includes("--skip-install")) flags.push("--skip-install")

// Step 1: Run the opencode build as a subprocess
if (!process.argv.includes("--skip-opencode-build")) {
  console.log("Running opencode build...")
  const buildArgs = ["run", "script/build.ts", ...flags]
  const result = Bun.spawnSync(["bun", ...buildArgs], {
    cwd: opencodePkgDir,
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env },
  })

  if (result.exitCode !== 0) {
    console.error(`opencode build failed with exit code ${result.exitCode}`)
    process.exit(1)
  }
} else {
  console.log("Skipping opencode build (--skip-opencode-build)")
}

// Step 2: Clean our dist
await $`rm -rf dist`
await $`mkdir -p dist`

// Step 3: Scan opencode dist for platform directories and copy+rename
const opencodeDistDir = path.join(opencodePkgDir, "dist")
if (!fs.existsSync(opencodeDistDir)) {
  console.error(`opencode dist directory not found at ${opencodeDistDir}`)
  process.exit(1)
}

const entries = fs.readdirSync(opencodeDistDir)
const platformDirs = entries.filter((entry) => {
  return entry.startsWith("opencode-") && fs.statSync(path.join(opencodeDistDir, entry)).isDirectory()
})

if (platformDirs.length === 0) {
  console.error("No platform directories found in opencode dist")
  process.exit(1)
}

for (const platformDir of platformDirs) {
  // Rename: opencode-darwin-arm64 → codemie-darwin-arm64
  const newName = platformDir.replace(/^opencode-/, "codemie-")
  const srcDir = path.join(opencodeDistDir, platformDir)
  const destDir = path.join(dir, "dist", newName)

  console.log(`Copying ${platformDir} → ${newName}`)
  await $`cp -r ${srcDir} ${destDir}`

  // Rename binaries inside bin/
  const binDir = path.join(destDir, "bin")
  if (fs.existsSync(binDir)) {
    const oldBin = path.join(binDir, "opencode")
    const newBin = path.join(binDir, "codemie")
    if (fs.existsSync(oldBin)) {
      fs.renameSync(oldBin, newBin)
    }

    const oldExe = path.join(binDir, "opencode.exe")
    const newExe = path.join(binDir, "codemie.exe")
    if (fs.existsSync(oldExe)) {
      fs.renameSync(oldExe, newExe)
    }
  }

  // Rewrite the platform package.json name field
  const pkgJsonPath = path.join(destDir, "package.json")
  if (fs.existsSync(pkgJsonPath)) {
    const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"))
    pkgJson.name = "@codemieai/" + pkgJson.name.replace(/^opencode-/, "codemie-")
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2))
  }
}

console.log("codemie build complete!")
console.log("Platform packages:")
for (const entry of fs.readdirSync(path.join(dir, "dist"))) {
  console.log(`  ${entry}`)
}
