#!/usr/bin/env bun

import { $ } from "bun"
import { mkdir, rm } from "fs/promises"
import path from "path"
import { Script } from "@bolt-ai/script"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import type { BunPlugin } from "bun"
import pkg from "../package.json"
import { discoverPluginRuntimeSpecifiers, pluginRuntimeLoaderCode } from "@opencode/plugin/runtime-modules"
import { buildAppArchive } from "./app-assets"
import { verifyArtifact, verifySimulationGraph } from "./verify-artifact"
import { resolveOpencodePty } from "./opencode-pty"
import { NativeArch } from "../../../script/native-arch"

const dir = path.resolve(import.meta.dirname, "..")
const binary = "bolt"
process.chdir(dir)

await rm(outdir, { recursive: true, force: true })

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const requestedTarget = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
const skipInstall = process.argv.includes("--skip-install")
const skipWebUi = process.argv.includes("--skip-web-ui")
const solidPlugin = createSolidTransformPlugin()
const highlights = Script.preview ? undefined : embed(process.env.OPENCODE_RELEASE_NOTES)
const releaseAssets = new Map<string, Promise<Map<string, string>>>()

const allTargets: {
  os: string
  arch: "arm64" | "x64"
  abi?: "musl"
  avx2?: false
}[] = [
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "linux", arch: "x64", avx2: false },
  { os: "linux", arch: "arm64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl" },
  { os: "linux", arch: "x64", abi: "musl", avx2: false },
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "darwin", arch: "x64", avx2: false },
  { os: "win32", arch: "arm64" },
  { os: "win32", arch: "x64" },
  { os: "win32", arch: "x64", avx2: false },
]

const targets =
  requestedTarget !== undefined
    ? allTargets.filter((item) => targetName(item) === requestedTarget)
    : singleFlag
      ? allTargets.filter((item) => {
          if (item.os !== process.platform || item.arch !== process.arch) return false
          if (item.avx2 === false) return baselineFlag
          return item.abi === undefined
        })
      : allTargets
if (!targets.length) throw new Error(`Unknown build target: ${requestedTarget}`)

// Bun 1.4.4 skips native packages for the other libc by default, but the musl targets need them.
if (!skipInstall)
  await $`bun install --os="*" --cpu="*" --libc="*" @opentui/core@${pkg.dependencies["@opentui/core"]} @opencode-ai/pty@${pkg.dependencies["@opencode-ai/pty"]}`
const appArchive = path.join(dir, ".cache", "bun-app-archive.bin")
await Bun.write(appArchive, await buildAppArchive(Script.channel, { skipBuild: skipWebUi }))
const appAssetsPlugin: BunPlugin = {
  name: "opencode-app-assets",
  setup(build) {
    build.onResolve({ filter: /^virtual:opencode-app-assets$/ }, () => ({
      path: "opencode-app-assets",
      namespace: "opencode",
    }))
    build.onLoad({ filter: /^opencode-app-assets$/, namespace: "opencode" }, () => ({
      loader: "js",
      // Embedded as a file, not a string: its bytes go into the executable once and unencoded.
      contents: `import { readFileSync } from "node:fs"
import archive from ${JSON.stringify(appArchive.replaceAll("\\", "/"))} with { type: "file" }
export default () => readFileSync(archive)`,
    }))
  },
}
const pluginRuntimeEntries = discoverPluginRuntimeSpecifiers()
const pluginRuntimeModulesSource = [
  "export const resolveHostPackageRoots = () => []",
  "const modules = {",
  ...[...pluginRuntimeEntries.keys()].map(
    (specifier) => `  ${JSON.stringify(specifier)}: ${pluginRuntimeLoaderCode(specifier, pluginRuntimeEntries)},`,
  ),
  "}",
  "export const loadRuntimeModules = () => modules",
].join("\n")
const pluginRuntimePlugin: BunPlugin = {
  name: "opencode-plugin-runtime",
  setup(build) {
    build.onLoad({ filter: /plugin[/\\]src[/\\]runtime-modules\.ts$/ }, () => ({
      contents: pluginRuntimeModulesSource,
      loader: "ts",
    }))
    build.onLoad({ filter: /[/\\]internal[/\\]httpApi(?:Scalar|Swagger)\.js$/ }, () => ({
      contents:
        'export const css = ""; export const javascript = \'document.body.textContent = "Scalar/Swagger UI assets are not bundled in OpenCode"\'',
      loader: "js",
    }))
  },
}

for (const item of targets) {
  const opencodePty = await resolveOpencodePty({
    platform: item.os,
    arch: item.arch,
    ...(item.os === "linux" ? { libc: item.abi ?? "glibc" } : {}),
  })
  const opencodePtyPlugin: BunPlugin = {
    name: "opencode-pty-binary",
    setup(build) {
      build.onLoad({ filter: /persistent-pty[/\\]pty-binding\.ts$/ }, () => ({
        loader: "js",
        contents: opencodePty
          ? `import file from ${JSON.stringify(opencodePty.source)} with { type: "file" }
export default { path: file, version: ${JSON.stringify(opencodePty.version)}, sha256: ${JSON.stringify(opencodePty.sha256)} }`
          : "export default undefined",
      }))
    },
  }
  const simulationInputs = new Set<string>()
  const simulationGraphPlugin: BunPlugin = {
    name: "opencode-simulation-graph",
    setup(build) {
      build.onLoad(
        { filter: /packages[/\\]simulation[/\\]src[/\\](frontend[/\\](simulation|server)|control-server)\.ts$/ },
        (args) => void simulationInputs.add(args.path),
      )
    },
  }
  const parcelWatcherPackage = `@parcel/watcher-${item.os}-${item.arch}${item.os === "linux" ? `-${item.abi ?? "glibc"}` : ""}`
  const parcelWatcherPlugin: BunPlugin = {
    name: "parcel-watcher-binding",
    setup(build) {
      build.onLoad({ filter: /filesystem[/\\]watcher-binding\.ts$/ }, () => ({
        contents: `export default () => require(${JSON.stringify(parcelWatcherPackage)})`,
        loader: "js",
      }))
    },
  }
  const target = targetName(item)
  const name = target.replace(binary, "cli")
  const executablePath = await compileExecutable(item)
  console.log(`building ${name}`)
  const result = await Bun.build({
    entrypoints: ["./src/index.ts"],
    tsconfig: "./tsconfig.json",
    plugins: [
      appAssetsPlugin,
      solidPlugin,
      parcelWatcherPlugin,
      opencodePtyPlugin,
      pluginRuntimePlugin,
      simulationGraphPlugin,
    ],
    external: ["node-gyp"],
    format: "esm",
    minify: true,
    bytecode: true,
    sourcemap: Script.channel === "dev" || Script.channel === "local" ? "inline" : "none",
    splitting: true,
    compile: {
      autoloadBunfig: false,
      autoloadDotenv: false,
      autoloadTsconfig: true,
      autoloadPackageJson: true,
      target: target.replace(binary, "bun") as Bun.Build.CompileTarget,
      ...(executablePath ? { executablePath } : {}),
      outfile: path.join(outdir, name, "bin", binary),
      execArgv: [
        "--smol",
        `--user-agent=opencode/${Script.channel}/${Script.version}/cli`,
        "--use-system-ca",
        "--no-warnings",
        "--",
      ],
      windows: {},
    },
    define: {
      BOLT_VERSION: `'${Script.version}'`,
      BOLT_CLI_NAME: `'${binary}'`,
      BOLT_MODELS_DEV: modelsData,
      BOLT_CHANNEL: `'${Script.channel}'`,
      BOLT_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "undefined",
      // FFF_LIBC selects the fff native lib variant: "musl" or "gnu".
      FFF_LIBC: item.os === "linux" ? `'${item.abi ?? "gnu"}'` : "undefined",
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  verifySimulationGraph(simulationInputs)
  await NativeArch.verify(path.join(outdir, name, "bin", item.os === "win32" ? `${binary}.exe` : binary), item.arch)

  await Bun.write(
    path.join(outdir, name, "package.json"),
    JSON.stringify(
      {
        name: `@bolt-ai/${name}`,
        version: Script.version,
        license: "AGPL-3.0-only",
        repository: {
          type: "git",
          url: "git+https://github.com/Bolt-builder/bolt-cli.git",
        },
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )

  // codesign only exists on macOS; release builds cross-compile darwin targets on Linux
  if (item.os === "darwin" && process.platform === "darwin") {
    await $`codesign --sign - ./dist/${name}/bin/${binary}`
  }
}
