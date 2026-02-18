#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const binaries: Record<string, string> = {}
const distDirs: Record<string, string> = {}
for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: "./dist" })) {
  const distPkg = await Bun.file(`./dist/${filepath}`).json()
  binaries[distPkg.name] = distPkg.version
  distDirs[distPkg.name] = `./dist/${filepath.replace("/package.json", "")}`
}
console.log("binaries", binaries)
const version = Object.values(binaries)[0]

if (!version) {
  console.error("No platform packages found in dist/. Run build first.")
  process.exit(1)
}

// Create the wrapper package directory
const wrapperName = "@codemieai/codemie-opencode"
const wrapperDir = `./dist/${pkg.name}`
await $`mkdir -p ${wrapperDir}`
await $`cp -r ./bin ${wrapperDir}/bin`
await $`cp ./script/postinstall.mjs ${wrapperDir}/postinstall.mjs`

// Write LICENSE
await Bun.file(`${wrapperDir}/LICENSE`).write("Apache-2.0\n\nSee https://www.apache.org/licenses/LICENSE-2.0\n")

await Bun.file(`${wrapperDir}/package.json`).write(
  JSON.stringify(
    {
      name: wrapperName,
      bin: {
        codemie: "./bin/codemie",
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: version,
      license: "Apache-2.0",
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

// Publish platform packages
const tasks = Object.entries(binaries).map(async ([name]) => {
  const pkgDir = distDirs[name]
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(pkgDir)
  }
  await $`bun pm pack`.cwd(pkgDir)
  await $`npm publish *.tgz --access restricted --tag ${Script.channel}`.cwd(pkgDir)
})
await Promise.all(tasks)

// Publish the wrapper package
await $`cd ${wrapperDir} && bun pm pack && npm publish *.tgz --access public --tag ${Script.channel}`

console.log(`Published ${wrapperName}@${version} with tag ${Script.channel}`)
