#!/usr/bin/env bun
import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import pkg from "../package.json"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const binaries: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "../opencode/dist" })) {
  const binPkg = await Bun.file(`../opencode/dist/${filepath}`).json()
  binaries[binPkg.name] = binPkg.version
}

if (Object.keys(binaries).length === 0) {
  throw new Error("No platform binaries found in packages/opencode/dist. Run build first.")
}

await $`mkdir -p ./dist/${pkg.name}`
await $`cp -r ./bin ./dist/${pkg.name}/bin`
await $`cp ./postinstall.mjs ./dist/${pkg.name}/postinstall.mjs`
await Bun.file(`./dist/${pkg.name}/LICENSE`).write(await Bun.file("../../LICENSE").text())

await Bun.file(`./dist/${pkg.name}/package.json`).write(
  JSON.stringify(
    {
      name: pkg.name,
      bin: { mysterycode: "./bin/mysterycode.cjs" },
      scripts: { postinstall: "node ./postinstall.mjs" },
      version: Script.version,
      license: pkg.license,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

await $`cd ./dist/${pkg.name} && bun pm pack && npm publish *.tgz --access public --tag ${Script.channel}`
