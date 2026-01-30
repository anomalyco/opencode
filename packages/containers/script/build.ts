#!/usr/bin/env bun

import { $ } from "bun"

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

const reg = process.env.REGISTRY ?? "ghcr.io/anomalyco"
const tag = process.env.TAG ?? "24.04"
const push = process.argv.includes("--push") || process.env.PUSH === "1"

const images = ["base", "bun-node", "rust", "tauri-linux", "publish"]

for (const name of images) {
  const image = `${reg}/build/${name}:${tag}`
  const file = `packages/containers/${name}/Dockerfile`
  const arg = name === "base" ? "" : `--build-arg REGISTRY=${reg}`
  console.log(`docker build -f ${file} -t ${image} ${arg} .`)
  if (arg) {
    await $`docker build -f ${file} -t ${image} --build-arg REGISTRY=${reg} .`
  } else {
    await $`docker build -f ${file} -t ${image} .`
  }

  if (push) {
    await $`docker push ${image}`
  }
}
