#!/usr/bin/env bun

/**
 * Script to publish development version to npm
 *
 * Usage:
 *   1. Make sure you have logged in to npm: npm login
 *   2. Run: bun run script/publish-dev.ts --name=your-package-name
 *
 * Example:
 *   bun run script/publish-dev.ts --name=opencode-ai-gitea
 *
 * Then install:
 *   bun install -g opencode-ai-gitea@latest
 */

import { $ } from "bun"
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"
import { Script } from "@opencode-ai/script"

const args = process.argv.slice(2)
const nameArg = args.find((a) => a.startsWith("--name="))
const packageName = nameArg?.split("=")[1] || "opencode-ai-dev"

console.log(`📦 Building and publishing as: ${packageName}`)
console.log(`📦 Version: ${Script.version}`)

const os = process.platform
const arch = process.arch

const targetName = [packageName, os === "win32" ? "windows" : os, arch].join("-")

console.log(`\n🔨 Building for current platform: ${os}-${arch}`)

await $`rm -rf dist`
await $`mkdir -p dist/${targetName}/bin`

const solidPlugin = (await import("../node_modules/@opentui/solid/scripts/solid-plugin")).default
const parserWorker = fs.realpathSync(path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"))
const workerPath = "./src/cli/cmd/tui/worker.ts"
const bunfsRoot = os === "win32" ? "B:/~BUN/root/" : "/$bunfs/root/"
const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

await Bun.build({
  conditions: ["browser"],
  tsconfig: "./tsconfig.json",
  plugins: [solidPlugin],
  sourcemap: "external",
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    //@ts-ignore
    autoloadTsconfig: true,
    autoloadPackageJson: true,
    target: targetName.replace(packageName, "bun") as any,
    outfile: `dist/${targetName}/bin/opencode`,
    execArgv: [`--user-agent=opencode/${Script.version}`, "--use-system-ca", "--"],
    windows: {},
  },
  entrypoints: ["./src/index.ts", parserWorker, workerPath],
  define: {
    OPENCODE_VERSION: `'${Script.version}'`,
    OTUI_TREE_SITTER_WORKER_PATH: bunfsRoot + workerRelativePath,
    OPENCODE_WORKER_PATH: workerPath,
    OPENCODE_CHANNEL: `'dev'`,
    OPENCODE_LIBC: os === "linux" ? `'glibc'` : "",
  },
})

await $`rm -rf ./dist/${targetName}/bin/tui`

// 写入 binary 包的 package.json
await Bun.file(`dist/${targetName}/package.json`).write(
  JSON.stringify(
    {
      name: targetName,
      version: Script.version,
      os: [os],
      cpu: [arch],
    },
    null,
    2,
  ),
)

// Write main package.json
await $`mkdir -p dist/${packageName}`
await Bun.file(`dist/${packageName}/package.json`).write(
  JSON.stringify(
    {
      name: packageName,
      version: Script.version,
      description: "OpenCode with Gitea/Forgejo support (development build)",
      license: "MIT",
      bin: {
        opencode: "./bin/opencode",
        [packageName]: "./bin/opencode",
      },
      optionalDependencies: {
        [targetName]: Script.version,
      },
    },
    null,
    2,
  ),
)

// 创建 bin wrapper
await $`mkdir -p dist/${packageName}/bin`
const binContent =
  os === "win32"
    ? `@echo off\n"%~dp0\\..\\node_modules\\${targetName}\\bin\\opencode.exe" %*`
    : `#!/bin/sh\nexec "$(dirname "$0")/../node_modules/${targetName}/bin/opencode" "$@"`

await Bun.file(`dist/${packageName}/bin/opencode`).write(binContent)
if (os !== "win32") {
  await $`chmod +x dist/${packageName}/bin/opencode`
}

console.log(`\n✅ Build complete!`)
console.log(`\n📤 To publish to npm:`)
console.log(`   cd dist/${targetName} && npm publish --access public`)
console.log(`   cd dist/${packageName} && npm publish --access public`)
console.log(`\n📥 Then install with:`)
console.log(`   bun install -g ${packageName}@${Script.version}`)
