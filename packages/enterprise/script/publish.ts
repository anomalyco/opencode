#!/usr/bin/env bun

import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"
import path from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
const root = path.resolve(dir, "../..")

process.chdir(dir)

// Build first
await import("./build")

if (!Script.preview) {
  process.chdir(root)
  const image = "ghcr.io/sst/opencode-enterprise"
  await $`docker build -f packages/enterprise/Dockerfile -t ${image}:${Script.version} .`
  await $`docker push ${image}:${Script.version}`
  await $`docker tag ${image}:${Script.version} ${image}:latest`
  await $`docker push ${image}:latest`
}
