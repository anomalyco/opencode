#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.resolve(__dirname, "..")
const repoRoot = path.resolve(dir, "../..")
const sidecarSrc = path.join(repoRoot, "packages", "voice-sidecar")

const skipOpencode = process.argv.includes("--skip-opencode")

process.chdir(dir)

const singleFlag = process.argv.includes("--single")
const version = JSON.parse(await Bun.file(path.join(dir, "package.json")).text()).version
const opencodeDir = path.join(repoRoot, "packages", "opencode")

const targets = [
  {
    os: process.platform,
    arch: process.arch as "arm64" | "x64",
  },
].filter((item) => singleFlag || (item.os === process.platform && item.arch === process.arch))

if (targets.length === 0) {
  console.error("no build targets")
  process.exit(1)
}

await $`rm -rf dist`

for (const item of targets) {
  const name = ["voxcode", item.os === "win32" ? "windows" : item.os, item.arch].filter(Boolean).join("-")
  console.log(`building ${name}`)
  await $`mkdir -p dist/${name}/bin`

  await Bun.build({
    conditions: ["bun", "node"],
    tsconfig: "./tsconfig.json",
    format: "esm",
    minify: true,
    sourcemap: "none",
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: name.replace("voxcode", "bun") as "bun-darwin-arm64",
      outfile: `dist/${name}/bin/voxcode`,
      execArgv: [`--user-agent=voxcode/${version}`, "--use-system-ca", "--"],
      windows: {},
    },
    entrypoints: ["./src/index.ts"],
    define: {
      VOXCODE_VERSION: `'${version}'`,
    },
  })

  const bundleDir = path.join(dir, "dist", name, "voice-sidecar")
  await $`rm -rf ${bundleDir}`
  await $`mkdir -p ${bundleDir}`
  await $`cp ${sidecarSrc}/pyproject.toml ${sidecarSrc}/README.md ${bundleDir}/`
  await $`cp -R ${sidecarSrc}/src ${bundleDir}/`

  const opencodeName = ["opencode", item.os === "win32" ? "windows" : item.os, item.arch].filter(Boolean).join("-")
  const opencodeBinary = path.join(opencodeDir, "dist", opencodeName, "bin", item.os === "win32" ? "opencode.exe" : "opencode")
  if (!skipOpencode && !fs.existsSync(opencodeBinary)) {
    console.log(`building ${opencodeName} for voxcode bundle`)
    await $`bun run --cwd ${opencodeDir} build --single`
  }
  if (fs.existsSync(opencodeBinary)) {
    await $`cp ${opencodeBinary} dist/${name}/bin/`
    console.log(`bundled opencode → dist/${name}/bin/`)
  } else if (!skipOpencode) {
    console.warn(`opencode binary missing at ${opencodeBinary} — voxcode will look for opencode on PATH`)
  }

  if (item.os === process.platform && item.arch === process.arch) {
    const binaryPath = `dist/${name}/bin/voxcode`
    console.log(`smoke test: ${binaryPath} --help`)
    const help = await $`${binaryPath} --help`.text()
    if (!help.includes("voxcode")) {
      console.error("smoke test failed")
      process.exit(1)
    }
  }

  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version,
        preferUnplugged: true,
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
}

console.log("done")
