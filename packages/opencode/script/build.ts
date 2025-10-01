#!/usr/bin/env bun

import solidPlugin from "../../../node_modules/@opentui/solid/scripts/solid-plugin"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)
import { $ } from "bun"
import path from "path"

import pkg from "../package.json"

const GOARCH: Record<string, string> = {
  arm64: "arm64",
  x64: "amd64",
  "x64-baseline": "amd64",
}

const targets = [
  ["windows", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["linux", "x64-baseline"],
  ["darwin", "x64"],
  ["darwin", "x64-baseline"],
  ["darwin", "arm64"],
]

await $`rm -rf dist`

const binaries: Record<string, string> = {}
const version = process.env["OPENCODE_VERSION"] ?? "dev"
for (const [os, arch] of targets) {
  console.log(`building ${os}-${arch}`)
  const name = `${pkg.name}-${os}-${arch}`
  await $`mkdir -p dist/${name}/bin`
  await $`CGO_ENABLED=0 GOOS=${os} GOARCH=${GOARCH[arch]} go build -ldflags="-s -w -X main.Version=${version}" -o ../opencode/dist/${name}/bin/tui ../tui/cmd/opencode/main.go`.cwd(
    "../tui",
  )
  const opentui = `@opentui/core-${os === "windows" ? "win32" : os}-${arch.replace("-baseline", "")}`
  await $`mkdir -p ../../node_modules/${opentui}`
  await $`npm pack npm pack ${opentui}`.cwd(path.join(dir, "../../node_modules")).quiet()
  await $`tar -xf ../../node_modules/${opentui.replace("@opentui/", "opentui-")}-*.tgz -C ../../node_modules/${opentui} --strip-components=1`

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
    entrypoints: ["./src/index.ts", path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")],
    define: {
      OPENCODE_VERSION: `'${version}'`,
      OPENCODE_TUI_PATH: `'../../../dist/${name}/bin/tui'`,
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
