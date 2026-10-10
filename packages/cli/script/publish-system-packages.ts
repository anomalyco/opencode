#!/usr/bin/env bun
import { Script } from "@opencode/script"
import { $ } from "bun"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { UpdateArtifact } from "../../../script/update-artifact"

if (Script.channel !== "beta" && Script.channel !== "latest") {
  throw new Error("System package publishing requires the beta or latest channel")
}

const dir = fileURLToPath(new URL("..", import.meta.url))
const root = path.resolve(process.env.OPENCODE_CLI_DIST ?? path.join(dir, "dist"))
const packagingDir = path.join(dir, "packaging")
const outputDir = path.join(root, "system-packages")
const dryRun = process.argv.includes("--dry-run")

const version = Script.version.replace(/^v/, "")

await $`mkdir -p ${outputDir}`

// ---------------------------------------------------------------------------
// Linux: DEB + RPM via nfpm
// ---------------------------------------------------------------------------

const archMap = {
  deb: { "x64-baseline": "amd64", arm64: "arm64" },
  rpm: { "x64-baseline": "x86_64", arm64: "aarch64" },
} as const

for (const arch of ["x64-baseline", "arm64"] as const) {
  const binaryDir = path.join(root, `cli-linux-${arch}`)
  const binaryPath = path.join(binaryDir, "bin", "opencode")

  if (!(await Bun.file(binaryPath).exists())) {
    throw new Error(`Binary not found: ${binaryPath}`)
  }

  // GitHub artifact downloads lose execute bits
  await $`chmod 755 ${binaryPath}`

  for (const format of ["deb", "rpm"] as const) {
    const nfpmArch = archMap[format][arch]
    console.log(`Building ${format} for ${nfpmArch}`)

    await $`nfpm pkg --config ${packagingDir}/nfpm.yaml --packager ${format} --target ${outputDir}/`.env({
      ...process.env,
      VERSION: version,
      NFPM_ARCH: nfpmArch,
      BINARY_PATH: binaryPath,
    })
  }
}

console.log("\nLinux packages built:")
await $`ls -la ${outputDir}/*.deb ${outputDir}/*.rpm`.nothrow()

// ---------------------------------------------------------------------------
// Validate packages before upload
// ---------------------------------------------------------------------------

const packages = await Array.fromAsync(new Bun.Glob("*.{deb,rpm}").scan({ cwd: outputDir, absolute: true }))

for (const pkg of packages) {
  const ext = pkg.endsWith(".deb") ? "deb" : "rpm"
  const result = await $`bash ${packagingDir}/validate.sh --${ext} ${pkg} --version ${version}`.nothrow()
  if (result.exitCode !== 0) {
    throw new Error(`Validation failed for ${path.basename(pkg)}`)
  }
}

// ---------------------------------------------------------------------------
// Upload to R2 and register update artifacts
// ---------------------------------------------------------------------------

if (!dryRun) {
  const files = await UpdateArtifact.upload({
    version: Script.version,
    files: packages,
    dryRun,
  })
  await UpdateArtifact.publish({
    channel: Script.channel,
    name: "cli",
    distribution: "system-packages",
    version: Script.version,
    metadata: { files },
  })
}

console.log("\n=== System package publishing complete ===")
