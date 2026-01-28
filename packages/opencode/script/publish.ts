#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const prefix = process.env["OPENCODE_BINARY_PREFIX"] ?? pkg.name
const publishName = process.env["OPENCODE_PUBLISH_NAME"] ?? `${pkg.name}-ai`
const skipRelease = process.env["OPENCODE_SKIP_RELEASE"] === "1"

const { binaries } = await import("./build.ts")
{
  const name = `${prefix}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/opencode --version`)
  await $`./dist/${name}/bin/opencode --version`
}

await $`mkdir -p ./dist/${publishName}`
await $`cp -r ./bin ./dist/${publishName}/bin`
await $`cp ./script/postinstall.mjs ./dist/${publishName}/postinstall.mjs`

await Bun.file(`./dist/${publishName}/package.json`).write(
  JSON.stringify(
    {
      name: publishName,
      bin: {
        [pkg.name]: `./bin/${pkg.name}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

const tags = [Script.channel]

const tasks = Object.entries(binaries).map(async ([name]) => {
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${name}`)
  }
  await $`bun pm pack`.cwd(`./dist/${name}`)
  for (const tag of tags) {
    await $`npm publish *.tgz --access public --tag ${tag}`.cwd(`./dist/${name}`)
  }
})
await Promise.all(tasks)
for (const tag of tags) {
  await $`cd ./dist/${publishName} && bun pm pack && npm publish *.tgz --access public --tag ${tag}`
}

if (!Script.preview && !skipRelease) {
  // Create archives for GitHub release
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`tar -czf ../../${key}.tar.gz *`.cwd(`dist/${key}/bin`)
    } else {
      await $`zip -r ../../${key}.zip *`.cwd(`dist/${key}/bin`)
    }
  }

  const image = "ghcr.io/anomalyco/opencode"
  const platforms = "linux/amd64,linux/arm64"
  const tags = [`${image}:${Script.version}`, `${image}:latest`]
  const tagFlags = tags.flatMap((t) => ["-t", t])
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
}
