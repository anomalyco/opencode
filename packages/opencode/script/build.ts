#!/usr/bin/env bun

import solidPlugin from "../node_modules/@opentui/solid/scripts/solid-plugin"
import path from "path"
import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

import pkg from "../package.json"

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
const version = process.env["OPENCODE_VERSION"] ?? "dev"
for (const [os, arch] of targets) {
  console.log(`building ${os}-${arch}`)
  const name = `${pkg.name}-${os}-${arch}`
  await $`mkdir -p dist/${name}/bin`

  const opentui = `@opentui/core-${os === "windows" ? "win32" : os}-${arch.replace("-baseline", "")}`
  await $`mkdir -p ../../node_modules/${opentui}`
  await $`npm pack npm pack ${opentui}`.cwd(path.join(dir, "../../node_modules")).quiet()
  await $`tar -xf ../../node_modules/${opentui.replace("@opentui/", "opentui-")}-*.tgz -C ../../node_modules/${opentui} --strip-components=1`

  const watcher = `@parcel/watcher-${os === "windows" ? "win32" : os}-${arch.replace("-baseline", "")}${os === "linux" ? "-glibc" : ""}`
  await $`mkdir -p ../../node_modules/${watcher}`
  await $`npm pack npm pack ${watcher}`.cwd(path.join(dir, "../../node_modules")).quiet()
  await $`tar -xf ../../node_modules/${watcher.replace("@parcel/", "parcel-")}-*.tgz -C ../../node_modules/${watcher} --strip-components=1`

  await Bun.build({
    conditions: ["browser"],
    tsconfig: "./tsconfig.json",
    plugins: [solidPlugin],
    compile: {
      target: `bun-${os}-${arch}` as any,
      outfile: `dist/${name}/bin/opencode`,
      execArgv: [`--user-agent=opencode/${version}`, `--env-file=""`, `--`],
      windows: {},
    },
    entrypoints: [
      "./src/index.ts",
      path.resolve(dir, "./node_modules/@opentui/core/parser.worker.js"),
      "./src/cli/cmd/tui/worker.ts",
    ],
    define: {
      OPENCODE_VERSION: `'${version}'`,
      OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/../../node_modules/@opentui/core/parser.worker.js",
    },
  })

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version,
        os: [os === "windows" ? "win32" : os],
        cpu: [arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = version
}

export { binaries }
