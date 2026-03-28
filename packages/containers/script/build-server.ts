#!/usr/bin/env bun

import { $ } from "bun"
import path from "path"
import { fileURLToPath } from "url"

const rootDir = fileURLToPath(new URL("../../..", import.meta.url))
process.chdir(rootDir)

const reg = process.env.REGISTRY ?? "ghcr.io/anomalyco"
const push = process.argv.includes("--push") || process.env.PUSH === "1"

const root = path.join(rootDir, "package.json")
const pkg = await Bun.file(root).json()
const manager = pkg.packageManager ?? ""
const bunVersion = manager.startsWith("bun@") ? manager.slice(4) : ""
if (!bunVersion) throw new Error("packageManager must be bun@<version>")

const variants = ["debian", "alpine"]

const setup = async () => {
  if (!push) return
  const list = await $`docker buildx ls`.text()
  if (list.includes("opencode-server")) {
    await $`docker buildx use opencode-server`
    return
  }
  await $`docker buildx create --name opencode-server --use`
}

await setup()

const platform = "linux/amd64,linux/arm64"

for (const variant of variants) {
  const image = `${reg}/opencode:dev-${variant}`
  const file = `packages/containers/server/docker/Dockerfile.${variant}`

  if (push) {
    console.log(`Building and pushing: ${image}`)
    await $`docker buildx build \
      --platform ${platform} \
      -f ${file} \
      -t ${image} \
      --push .`
  } else {
    console.log(`Building: ${image}`)
    await $`docker buildx build \
      --platform ${platform} \
      -f ${file} \
      -t ${image} \
      .`
  }

  console.log(`✓ ${image}`)
}
