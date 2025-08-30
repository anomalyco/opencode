#!/usr/bin/env bun

/**
 * Build script for creating standalone binaries for multiple platforms
 * Usage: bun run ./script/build-binaries.ts
 */

import { $ } from "bun"
import { existsSync, mkdirSync } from "fs"
import { join } from "path"

const targets = [
  { platform: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
  { platform: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
  { platform: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
  { platform: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
  { platform: "windows", arch: "x64", bunTarget: "bun-windows-x64" },
]

const version = process.env.VERSION || "dev"
const outDir = join(process.cwd(), "dist")

// Create output directory
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true })
}

console.log(`Building lash CLI binaries v${version}...`)
console.log(`Output directory: ${outDir}`)

for (const target of targets) {
  const outputName = `lash-${target.platform}-${target.arch}${target.platform === "windows" ? ".exe" : ""}`
  const outputPath = join(outDir, outputName)
  
  console.log(`\nBuilding ${outputName}...`)
  
  try {
    // Build the binary
    await $`bun build ./src/index.ts --compile --target=${target.bunTarget} --outfile=${outputPath}`
    
    console.log(`✓ Built ${outputName}`)
    
    // Create archive
    const archiveName = `lash-${version}-${target.platform}-${target.arch}`
    if (target.platform === "windows") {
      // For Windows, create a zip file
      await $`zip -j ${outDir}/${archiveName}.zip ${outputPath} README.md LICENSE`
    } else {
      // For Unix systems, create a tar.gz
      await $`tar -czf ${outDir}/${archiveName}.tar.gz -C ${outDir} ${outputName} -C ${process.cwd()} README.md LICENSE`
    }
    
    console.log(`✓ Created archive ${archiveName}`)
  } catch (error) {
    console.error(`✗ Failed to build ${outputName}:`, error)
    process.exit(1)
  }
}

// Create checksums
console.log("\nGenerating checksums...")
await $`cd ${outDir} && sha256sum *.tar.gz *.zip > checksums.txt`
console.log("✓ Generated checksums.txt")

console.log("\n✨ Build complete!")
console.log(`Binaries available in: ${outDir}`)