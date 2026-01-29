#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

let output = [`version=${Script.version}`]

if (!Script.preview) {
  await $`gh release create v${Script.version} -d --title "v${Script.version}" ${Script.preview ? "--prerelease" : ""}`
  const release = await $`gh release view v${Script.version} --json id,tagName`.json()
  output.push(`release=${release.id}`)
  output.push(`tag=${release.tagName}`)
}

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}
