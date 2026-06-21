#!/usr/bin/env bun

import { $ } from "bun"
import fs from "fs"
import { rm } from "fs/promises"
import path from "path"
import { Script } from "@opencode-ai/script"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"
import pkg from "../package.json"
import { modelsData } from "./generate"

const dir = path.resolve(import.meta.dirname, "..")
const binary = "zero"
process.chdir(dir)

await rm("dist", { recursive: true, force: true })

const singleFlag = process.argv.includes("--single")
const baselineFlag = process.argv.includes("--baseline")
const skipInstall = process.argv.includes("--skip-install")
const sourcemapsFlag = process.argv.includes("--sourcemaps")
const noCompileFlag = process.argv.includes("--no-compile")
const plugin = createSolidTransformPlugin()

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

const targets = singleFlag
  ? allTargets.filter((item) => {
      if (item.os !== process.platform || item.arch !== process.arch) return false
      if (item.avx2 === false) return baselineFlag
      return item.abi === undefined
    })
  : allTargets

if (!skipInstall) await $`bun install --os="*" --cpu="*" @opentui/core@${pkg.dependencies["@opentui/core"]}`

const localParserWorker = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
const rootParserWorker = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
const parserWorker = fs.realpathSync(fs.existsSync(localParserWorker) ? localParserWorker : rootParserWorker)

// Ensure @opentui/core platform-specific packages are available for the resolver.
// These are optionalDependencies, so they might not be installed. We need to install them.
const platformPackages = [
  "@opentui/core-linux-arm64",
  "@opentui/core-linux-arm64-musl",
]
if (!skipInstall) {
  for (const pkg of platformPackages) {
    try {
      await $`bun install --os="*" --cpu="*" ${pkg}@${pkg.dependencies?.["@opentui/core"] || "0.3.4"}`
    } catch (e) {
      console.warn(`Warning: Failed to install ${pkg}: ${e}`)
    }
  }
}

for (const item of targets) {
  const target = [
    binary,
    item.os === "win32" ? "windows" : item.os,
    item.arch,
    item.avx2 === false ? "baseline" : undefined,
    item.abi,
  ]
    .filter(Boolean)
    .join("-")
  const name = target.replace(binary, "cli")
  console.log("building " + name)
  
  let buildOutputOptions;
  if (noCompileFlag) {
    buildOutputOptions = {
      outdir: `./dist/${name}`,
      target: "bun",
    };
  } else {
    buildOutputOptions = {
      compile: {
        autoloadBunfig: false,
        autoloadDotenv: false,
        autoloadTsconfig: true,
        autoloadPackageJson: true,
        target: target.replace(binary, "bun") as Bun.Build.CompileTarget,
        outfile: `./dist/${name}/bin/${binary}`,
        execArgv: [`--user-agent=${binary}/${Script.version}`, "--use-system-ca", "--"],
        windows: {},
      },
    };
  }

  const result = await Bun.build({
    entrypoints: ["./src/index.ts", ...(noCompileFlag ? [] : [parserWorker])],
    tsconfig: "./tsconfig.json",
    plugins: [plugin],
    external: [
      "node-gyp",
      // Platform-specific native bindings for @opentui/core.
      // These are optionalDependencies and should be resolved through @opentui/core.
      // We do not externalize them to allow Bun to resolve them via the main package.
    ],
    format: "esm",
    minify: true,
    sourcemap: sourcemapsFlag ? "linked" : "none",
    splitting: !noCompileFlag,
    ...buildOutputOptions, // Spread the conditionally defined options
    define: {
      OPENCODE_VERSION: `'${Script.version}'`,
      OPENCODE_CLI_NAME: `'${binary}'`,
      OPENCODE_MODELS_DEV: modelsData,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
      OPENCODE_LIBC: item.os === "linux" ? `'${item.abi ?? "glibc"}'` : "undefined",
      // FFF_LIBC selects the fff native lib variant: "musl" or "gnu".
      FFF_LIBC: item.os === "linux" ? `'${item.abi ?? "gnu"}'` : "undefined",
      OTUI_TREE_SITTER_WORKER_PATH:
        (item.os === "win32" ? '"B:/~BUN/root/' : '"/$bunfs/root/') +
        path.relative(dir, parserWorker).replaceAll("\\", "/") +
        '"',
      ...(item.os === "linux" ? { "process.env.OPENTUI_LIBC": JSON.stringify(item.abi ?? "glibc") } : {}),
    },
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }

  await Bun.write(
    `./dist/${name}/package.json`,
    JSON.stringify(
      {
        name: `@opencode-ai/${name}`,
        version: Script.version,
        license: "MIT",
        repository: { type: "git", url: "git+https://github.com/anomalyco/opencode.git" },
        os: [item.os],
        cpu: [item.arch],
      },
      null,
      2,
    ),
  )
}
