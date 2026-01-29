#!/usr/bin/env bun
import { $ } from "bun"
import pkg from "../package.json"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

// Allow overriding package name via env var (e.g. NPM_PACKAGE=@adriancooney/opencode)
const packageName = process.env.NPM_PACKAGE || pkg.name

// Helper to convert npm package name to directory name (strips scope)
const toDir = (name: string) => name.replace(/^@[^/]+\//, "")

const { binaries } = await import("./build.ts")
{
  const name = `${packageName}-${process.platform}-${process.arch}`
  const dirName = toDir(name)
  console.log(`smoke test: running dist/${dirName}/bin/opencode --version`)
  await $`./dist/${dirName}/bin/opencode --version`
}

const mainDir = toDir(packageName)
await $`mkdir -p ./dist/${mainDir}`
await $`cp -r ./bin ./dist/${mainDir}/bin`
await $`cp ./script/postinstall.mjs ./dist/${mainDir}/postinstall.mjs`

await Bun.file(`./dist/${mainDir}/package.json`).write(
  JSON.stringify(
    {
      name: packageName,
      bin: {
        opencode: `./bin/opencode`,
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

// Sanitize tag - npm tags can't have slashes
const rawTag = Script.channel
const tag = rawTag.replace(/\//g, "-")
const tags = [tag]

const tasks = Object.entries(binaries).map(async ([name]) => {
  const dirName = toDir(name)
  if (process.platform !== "win32") {
    await $`chmod -R 755 .`.cwd(`./dist/${dirName}`)
  }
  await $`bun pm pack`.cwd(`./dist/${dirName}`)
  for (const t of tags) {
    await $`npm publish *.tgz --access public --tag ${t}`.cwd(`./dist/${dirName}`)
  }
})
await Promise.all(tasks)
for (const t of tags) {
  await $`cd ./dist/${mainDir} && bun pm pack && npm publish *.tgz --access public --tag ${t}`
}

if (!Script.preview) {
  // Create archives for GitHub release
  for (const key of Object.keys(binaries)) {
    const dirName = toDir(key)
    if (key.includes("linux")) {
      await $`tar -czf ../../${dirName}.tar.gz *`.cwd(`dist/${dirName}/bin`)
    } else {
      await $`zip -r ../../${dirName}.zip *`.cwd(`dist/${dirName}/bin`)
    }
  }

  const image = "ghcr.io/anomalyco/opencode"
  const platforms = "linux/amd64,linux/arm64"
  const tags = [`${image}:${Script.version}`, `${image}:latest`]
  const tagFlags = tags.flatMap((t) => ["-t", t])
  await $`docker buildx build --platform ${platforms} ${tagFlags} --push .`
}
