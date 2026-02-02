#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { buildNotes, getLatestRelease } from "./changelog"

const output = [`version=${Script.version}`]

if (!Script.preview) {
  const previous = await getLatestRelease()
  const notes = await buildNotes(previous, "HEAD")
  const body = notes.join("\n") || "No notable changes"
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const file = `${dir}/opencode-release-notes.txt`
  await Bun.write(file, body)
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --notes-file ${file}`
  const release = await $`gh release view v${Script.version} --json id,tagName`.json()
  output.push(`release=${release.id}`)
  output.push(`tag=${release.tagName}`)
}

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
