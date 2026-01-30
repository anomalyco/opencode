#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { buildNotes, getLatestRelease } from "./changelog"

const output = [`version=${Script.version}`]

if (!Script.preview) {
  await $`gh release create v${Script.version} -d --title "v${Script.version}" ${Script.preview ? "--prerelease" : ""}`
  const release = await $`gh release view v${Script.version} --json id,tagName`.json()
  const previous = await getLatestRelease(Script.version)
  const notes = await buildNotes(previous, "HEAD")
  const body = notes.join("\n") || "No notable changes"
  await $`gh release edit v${Script.version} --draft=false --title "v${Script.version}" --notes ${body}`
  output.push(`release=${release.id}`)
  output.push(`tag=${release.tagName}`)
}

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}
