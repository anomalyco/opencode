#!/usr/bin/env bun

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import fs from "fs"
import { $ } from "bun"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)

import pkg from "../package.json"
import { Script } from "@opencode-ai/script"

const singleFlag = process.argv.includes("--single")

const allTargets = [
  ["windows", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["linux", "x64-baseline"],
  ["darwin", "x64"],
  ["darwin", "x64-baseline"],
  ["darwin", "arm64"],
]

const targets = singleFlag
  ? allTargets.filter(([os, arch]) => os === process.platform && arch === process.arch)
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
for (const [os, arch] of targets) {
  console.log(`building ${os}-${arch}`)
  const name = `${pkg.name}-${os}-${arch}`
  await $`mkdir -p dist/${name}/bin`

  const opentui = `@opentui/core-${os === "windows" ? "win32" : os}-${arch.replace("-baseline", "")}`
  await $`mkdir -p ../../node_modules/${opentui}`
  await $`npm pack ${opentui}@${pkg.dependencies["@opentui/core"]}`.cwd(path.join(dir, "../../node_modules"))
  await $`tar -xf ../../node_modules/${opentui.replace("@opentui/", "opentui-")}-*.tgz -C ../../node_modules/${opentui} --strip-components=1`

  const watcher = `@parcel/watcher-${os === "windows" ? "win32" : os}-${arch.replace("-baseline", "")}${os === "linux" ? "-glibc" : ""}`
  await $`mkdir -p ../../node_modules/${watcher}`
  await $`npm pack ${watcher}`.cwd(path.join(dir, "../../node_modules")).quiet()
  await $`tar -xf ../../node_modules/${watcher.replace("@parcel/", "parcel-")}-*.tgz -C ../../node_modules/${watcher} --strip-components=1`

  const parserWorker = fs.realpathSync(path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"))
  const workerPath = "./src/cli/cmd/tui/worker.ts"

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    sourcemap: "external",
    compile: {
      target: `bun-${os}-${arch}` as any,
      outfile: `dist/${name}/bin/opencode`,
      execArgv: [`--user-agent=opencode/${Script.version}`, `--env-file=""`, `--`],
      windows: {},
    },
    entrypoints: ["./src/index.ts", parserWorker, workerPath],
    define: {
      OPENCODE_VERSION: `'${Script.version}'`,
      OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/" + path.relative(dir, parserWorker),
      OPENCODE_WORKER_PATH: workerPath,
      OPENCODE_CHANNEL: `'${Script.channel}'`,
    },
  })

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: Script.version,
        os: [os === "windows" ? "win32" : os],
        cpu: [arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = Script.version
}

export { binaries }
