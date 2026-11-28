#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]

if (!Script.preview) {
  const body = process.env.OPENCODE_RELEASE_NOTES?.trim()
  if (!body) throw new Error("Provide reviewed release_notes when dispatching a versioned v1 release")
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/opencode-release-notes.txt`
  await Bun.write(notesFile, body)
  // No --target: GitHub requires the workflows permission, which github.token can't have, when the target's
  // workflow files differ from dev. The draft attaches to the tag script/publish.ts pushes.
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --notes-file ${notesFile}`
  const release = await $`gh release view v${Script.version} --json tagName,databaseId`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
