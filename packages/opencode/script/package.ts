#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"
import { Script } from "@opencode-ai/script"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.resolve(__dirname, "..")
const packagingDir = path.join(pkgDir, "packaging")
const distDir = path.join(pkgDir, "dist")
const outputDir = path.join(distDir, "packages")

const buildLinux = process.argv.includes("--linux")
const buildMacos = process.argv.includes("--macos")
const archFlag = process.argv.find((_, i, a) => a[i - 1] === "--arch") ?? ""

if (!buildLinux && !buildMacos) {
  console.error("Usage: package.ts --linux | --macos --arch <x64|arm64>")
  process.exit(1)
}

await $`mkdir -p ${outputDir}`

const version = Script.version.replace(/^v/, "")

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Extract the opencode binary to destDir. Supports both archive files
// (produced on release builds) and unpacked directory trees (produced on all
// builds). Returns the path to the extracted binary.
async function extractBinary(os: string, arch: string, destDir: string): Promise<string> {
  await $`mkdir -p ${destDir}`

  if (os === "linux") {
    const archive = path.join(distDir, `opencode-linux-${arch}.tar.gz`)
    if (await Bun.file(archive).exists()) {
      await $`tar -xzf ${archive} -C ${destDir}`
      return path.join(destDir, "opencode")
    }
  } else {
    const archive = path.join(distDir, `opencode-darwin-${arch}.zip`)
    if (await Bun.file(archive).exists()) {
      await $`unzip -o ${archive} -d ${destDir}`
      return path.join(destDir, "opencode")
    }
  }

  // Fallback: copy from the unpacked directory tree produced by build.ts
  const dirName = `opencode-${os === "linux" ? "linux" : "darwin"}-${arch}`
  const dirBinary = path.join(distDir, dirName, "bin", "opencode")
  if (await Bun.file(dirBinary).exists()) {
    await $`cp ${dirBinary} ${destDir}/opencode`
    await $`chmod 755 ${destDir}/opencode`
    return path.join(destDir, "opencode")
  }

  throw new Error(`No binary found for ${os}-${arch} (checked archive and directory)`)
}

// ---------------------------------------------------------------------------
// Shell completions — generated once from a native binary (arch-independent)
// ---------------------------------------------------------------------------

async function generateCompletions(binaryPath: string, completionsDir: string) {
  await $`mkdir -p ${completionsDir}`
  console.log(`Generating shell completions from ${binaryPath}`)

  // Set HOME to a temp dir so the binary doesn't try to read/write user config
  const env = { ...process.env, HOME: "/tmp/opencode-pkg-completions" }
  await $`mkdir -p /tmp/opencode-pkg-completions`

  await $`${binaryPath} completion > ${completionsDir}/opencode.bash`.env(env).nothrow()

  // Yargs checks the SHELL env var to determine completion output format
  // (same trick used by the Nix build in nix/opencode.nix)
  await $`${binaryPath} completion > ${completionsDir}/opencode.zsh`
    .env({ ...env, SHELL: "/bin/zsh" })
    .nothrow()

  // Fish completions — try with SHELL override; if the binary doesn't support
  // fish completions, create an empty placeholder so nfpm doesn't fail.
  const fishResult = await $`${binaryPath} completion > ${completionsDir}/opencode.fish`
    .env({ ...env, SHELL: "/usr/bin/fish" })
    .nothrow()
  if (fishResult.exitCode !== 0) {
    await Bun.write(`${completionsDir}/opencode.fish`, "# fish completions not yet available\n")
  }
}

// ---------------------------------------------------------------------------
// Linux: DEB + RPM via nfpm
// ---------------------------------------------------------------------------

async function buildLinuxPackages() {
  console.log("\n=== Building Linux CLI packages ===\n")

  const completionsDir = path.join(distDir, "completions")

  // Generate completions from the native x64 binary (works for both arches)
  const nativeBinDir = path.join(distDir, "native-bin")
  const nativeBinary = await extractBinary("linux", "x64", nativeBinDir)
  await generateCompletions(nativeBinary, completionsDir)

  const archMap = {
    deb: { x64: "amd64", arm64: "arm64" },
    rpm: { x64: "x86_64", arm64: "aarch64" },
  } as const

  for (const arch of ["x64", "arm64"] as const) {
    const binDir = path.join(distDir, `pkg-staging-linux-${arch}`)
    const binaryPath = await extractBinary("linux", arch, binDir)

    for (const format of ["deb", "rpm"] as const) {
      const nfpmArch = archMap[format][arch]
      console.log(`Building ${format} for ${nfpmArch}`)

      const env = {
        ...process.env,
        VERSION: version,
        NFPM_ARCH: nfpmArch,
        BINARY_PATH: binaryPath,
        COMPLETIONS_DIR: completionsDir,
      }

      await $`nfpm pkg --config ${packagingDir}/nfpm.yaml --packager ${format} --target ${outputDir}/`
        .env(env)
    }

    await $`rm -rf ${binDir}`
  }

  await $`rm -rf ${nativeBinDir}`
  console.log("\nLinux packages built:")
  await $`ls -la ${outputDir}/*.deb ${outputDir}/*.rpm`.nothrow()
}

// ---------------------------------------------------------------------------
// macOS: .pkg via pkgbuild + productbuild + productsign + notarytool
// ---------------------------------------------------------------------------

async function buildMacosPackage(arch: string) {
  console.log(`\n=== Building macOS CLI .pkg for ${arch} ===\n`)

  const stagingRoot = path.join(distDir, `pkg-staging-macos-${arch}`)
  const binDir = path.join(distDir, `macos-bin-${arch}`)
  const completionsDir = path.join(distDir, "completions")

  // Extract binary (handles both archive and directory layouts)
  const binaryPath = await extractBinary("darwin", arch, binDir)

  // Generate completions from the native binary
  await generateCompletions(binaryPath, completionsDir)

  // Create staging directory with macOS-standard paths
  await $`mkdir -p ${stagingRoot}/usr/local/bin`
  await $`mkdir -p ${stagingRoot}/usr/local/share/bash-completion/completions`
  await $`mkdir -p ${stagingRoot}/usr/local/share/zsh/site-functions`
  await $`mkdir -p ${stagingRoot}/usr/local/share/fish/vendor_completions.d`

  await $`cp ${binaryPath} ${stagingRoot}/usr/local/bin/opencode`
  await $`chmod 755 ${stagingRoot}/usr/local/bin/opencode`
  await $`cp ${completionsDir}/opencode.bash ${stagingRoot}/usr/local/share/bash-completion/completions/opencode`
  await $`cp ${completionsDir}/opencode.zsh ${stagingRoot}/usr/local/share/zsh/site-functions/_opencode`
  await $`cp ${completionsDir}/opencode.fish ${stagingRoot}/usr/local/share/fish/vendor_completions.d/opencode.fish`

  // Build component package
  const componentPkg = path.join(distDir, `opencode-component-${arch}.pkg`)
  await $`pkgbuild \
    --root ${stagingRoot} \
    --identifier ai.opencode.cli \
    --version ${version} \
    --scripts ${packagingDir}/scripts \
    ${componentPkg}`

  // Copy LICENSE for the distribution
  const licenseFile = path.join(distDir, "LICENSE")
  await $`cp ${path.join(pkgDir, "../../LICENSE")} ${licenseFile}`

  // Render distribution.xml with version and component pkg name
  const distXmlTemplate = await Bun.file(path.join(packagingDir, "distribution.xml")).text()
  const distXml = distXmlTemplate
    .replace(/\$\{VERSION\}/g, version)
    .replace(/\$\{COMPONENT_PKG\}/g, path.basename(componentPkg))
  const distXmlPath = path.join(distDir, `distribution-${arch}.xml`)
  await Bun.write(distXmlPath, distXml)

  const unsignedPkg = path.join(distDir, `opencode-${version}-${arch}-unsigned.pkg`)
  const finalPkg = path.join(outputDir, `opencode-${version}-${arch}.pkg`)

  await $`productbuild \
    --distribution ${distXmlPath} \
    --package-path ${distDir} \
    --resources ${distDir} \
    ${unsignedPkg}`

  // Sign the package if we're in CI with Apple credentials
  const isCI = process.env.GITHUB_ACTIONS === "true"
  const hasSigningIdentity = !!process.env.APPLE_API_KEY

  if (isCI && hasSigningIdentity) {
    console.log("Signing .pkg with Developer ID Installer certificate")

    // Find the Developer ID Installer identity from the keychain
    const identities = await $`security find-identity -v -p basic`.text()
    const match = identities.match(/"(Developer ID Installer:[^"]+)"/)
    const identity = match ? match[1] : ""

    if (identity) {
      // Bun's $ template automatically quotes interpolated values
      await $`productsign --sign ${identity} ${unsignedPkg} ${finalPkg}`
      await $`rm ${unsignedPkg}`

      // Notarize
      console.log("Submitting .pkg for notarization")
      await $`xcrun notarytool submit ${finalPkg} \
        --key ${process.env.APPLE_API_KEY} \
        --key-id ${process.env.APPLE_API_KEY_ID} \
        --issuer ${process.env.APPLE_API_ISSUER} \
        --wait --timeout 600`

      await $`xcrun stapler staple ${finalPkg}`
      console.log("Package signed and notarized successfully")
    } else {
      console.warn("No Developer ID Installer identity found, producing unsigned package")
      await $`mv ${unsignedPkg} ${finalPkg}`
    }
  } else {
    console.log("No signing credentials available, producing unsigned package")
    await $`mv ${unsignedPkg} ${finalPkg}`
  }

  // Cleanup
  await $`rm -rf ${stagingRoot} ${binDir} ${componentPkg} ${distXmlPath} ${licenseFile}`

  console.log(`\nmacOS package built: ${finalPkg}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (buildLinux) {
  await buildLinuxPackages()
}

if (buildMacos) {
  if (!archFlag || !["x64", "arm64"].includes(archFlag)) {
    console.error("--macos requires --arch <x64|arm64>")
    process.exit(1)
  }
  await buildMacosPackage(archFlag)
}

console.log("\n=== Packaging complete ===")
await $`ls -la ${outputDir}/`.nothrow()
