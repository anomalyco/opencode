#!/usr/bin/env bun
import { $ } from "bun"
import { Script } from "@opencode-ai/script"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
const root = fileURLToPath(new URL("../../..", import.meta.url))
process.chdir(dir)

// Build first
await import("./build")

if (!Script.preview) {
  process.chdir(root)
  const image = "ghcr.io/sst/opencode-enterprise"
  await $`docker buildx build --platform linux/amd64,linux/arm64 -f packages/enterprise/Dockerfile -t ${image}:${Script.version} -t ${image}:latest --push .`
}
