#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

async function published(name: string, version: string) {
  return (await $`npm view ${name}@${version} version`.nothrow()).exitCode === 0
}

async function publish(dir: string, name: string, version: string) {
  if (process.platform !== "win32") await $`chmod -R 755 .`.cwd(dir)
  if (await published(name, version)) return console.log(`already published ${name}@${version}`)
  await $`bun pm pack`.cwd(dir)
  await $`npm publish *.tgz --access public --tag ${Script.channel}`.cwd(dir)
}

async function publishDistribution(input: { root: string; name: string; binary: string; packagePrefix: string }) {
  const binaries: Record<string, string> = {}
  for (const filepath of new Bun.Glob("*/package.json").scanSync({ cwd: input.root })) {
    const item = await Bun.file(`${input.root}/${filepath}`).json()
    if (!item.name.startsWith(input.packagePrefix)) continue
    binaries[item.name] = item.version
  }
  console.log(input.name, "binaries", binaries)
  const versions = new Set(Object.values(binaries))
  if (versions.size > 1) throw new Error(`Binary package versions do not match for ${input.name}`)
  const version = versions.values().next().value
  if (!version) throw new Error(`No binary packages found for ${input.name}`)

  await $`mkdir -p ${input.root}/${input.name}/bin`
  await $`cp ./bin/opencode2.cjs ${input.root}/${input.name}/bin/${input.binary}`
  await Bun.file(`${input.root}/${input.name}/package.json`).write(
    JSON.stringify(
      {
        name: input.name,
        bin: { [input.binary]: `./bin/${input.binary}` },
        version,
        license: pkg.license,
        repository: { type: "git", url: "git+https://github.com/anomalyco/opencode.git" },
        os: ["darwin", "linux", "win32"],
        cpu: ["arm64", "x64"],
        optionalDependencies: binaries,
      },
      null,
      2,
    ),
  )

  await Promise.all(
    Object.entries(binaries).map(([name, version]) =>
      publish(`${input.root}/${name.replace("@opencode-ai/", "")}`, name, version),
    ),
  )
  await publish(`${input.root}/${input.name}`, input.name, version)
}

await publishDistribution({
  root: "./dist",
  name: pkg.name,
  binary: "opencode2",
  packagePrefix: "@opencode-ai/cli-",
})
await publishDistribution({
  root: "./dist/node",
  name: "opencode2-node",
  binary: "opencode2-node",
  packagePrefix: "@opencode-ai/cli-node-",
})
