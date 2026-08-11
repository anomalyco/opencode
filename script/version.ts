#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const output = [`version=${Script.version}`]
const sha = process.env.GITHUB_SHA ?? (await $`git rev-parse HEAD`.text()).trim()

if (!Script.preview) {
  // Best-effort: changelog.ts AI-generates release notes by shelling out to a coding agent. That is
  // no longer installed in CI (it was upstream's own CLI, and needed their API key), so a failure
  // here must not abort the release — the notes fall back to "No notable changes" below.
  await $`bun script/changelog.ts --to ${sha}`.cwd(process.cwd()).nothrow()
  const file = `${process.cwd()}/UPCOMING_CHANGELOG.md`
  const body = await Bun.file(file)
    .text()
    .catch(() => "No notable changes")
  const dir = process.env.RUNNER_TEMP ?? "/tmp"
  const notesFile = `${dir}/opencode-release-notes.txt`
  await Bun.write(notesFile, body)
  await $`gh release create v${Script.version} -d --target ${sha} --title "v${Script.version}" --notes-file ${notesFile}`
  const release = await $`gh release view v${Script.version} --json tagName,databaseId`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
} else if (Script.channel === "beta") {
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --repo ${process.env.GH_REPO}`
  const release =
    await $`gh release view v${Script.version} --json tagName,databaseId --repo ${process.env.GH_REPO}`.json()
  output.push(`release=${release.databaseId}`)
  output.push(`tag=${release.tagName}`)
}

output.push(`repo=${process.env.GH_REPO}`)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output.join("\n"))
}

process.exit(0)
