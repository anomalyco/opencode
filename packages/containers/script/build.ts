#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"

const rootDir = fileURLToPath(new URL("../../..", import.meta.url))
process.chdir(rootDir)

const reg = process.env.REGISTRY ?? "ghcr.io/anomalyco"
const tag = process.env.TAG ?? "24.04"
const push = process.argv.includes("--push") || process.env.PUSH === "1"

const root = path.join(rootDir, "package.json")
const pkg = await Bun.file(root).json()
const manager = pkg.packageManager ?? ""
const bun = manager.startsWith("bun@") ? manager.slice(4) : ""
if (!bun) throw new Error("packageManager must be bun@<version>")

const images = ["base", "bun-node", "rust", "tauri-linux", "publish"]

const setup = async () => {
  if (!push) return
  const list = await $`docker buildx ls`.text()
  if (list.includes("opencode")) {
    await $`docker buildx use opencode`
    return
  }
  await $`docker buildx create --name opencode --use`
}

await setup()

const platform = "linux/amd64,linux/arm64"

for (const name of images) {
  const image = `${reg}/build/${name}:${tag}`
  const file = `packages/containers/${name}/Dockerfile`
  if (name === "base") {
    if (push) {
      console.log(`docker buildx build --platform ${platform} -f ${file} -t ${image} --push .`)
      await $`docker buildx build --platform ${platform} -f ${file} -t ${image} --push .`
    }
    if (!push) {
      console.log(`docker build -f ${file} -t ${image} .`)
      await $`docker build -f ${file} -t ${image} .`
    }
  }
  if (name === "bun-node") {
    if (push) {
      console.log(
        `docker buildx build --platform ${platform} -f ${file} -t ${image} --build-arg REGISTRY=${reg} --build-arg BUN_VERSION=${bun} --push .`,
      )
      await $`docker buildx build --platform ${platform} -f ${file} -t ${image} --build-arg REGISTRY=${reg} --build-arg BUN_VERSION=${bun} --push .`
    }
    if (!push) {
      console.log(`docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} --build-arg BUN_VERSION=${bun} .`)
      await $`docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} --build-arg BUN_VERSION=${bun} .`
    }
  }
  if (name !== "base" && name !== "bun-node") {
    if (push) {
      console.log(
        `docker buildx build --platform ${platform} -f ${file} -t ${image} --build-arg REGISTRY=${reg} --push .`,
      )
      await $`docker buildx build --platform ${platform} -f ${file} -t ${image} --build-arg REGISTRY=${reg} --push .`
    }
    if (!push) {
      console.log(`docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} .`)
      await $`docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} .`
    }
  }

  if (push) {
    console.log(`pushed ${image}`)
  }
}
