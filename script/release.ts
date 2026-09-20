#!/usr/bin/env bun

import { $ } from "bun"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { rm } from "fs/promises"
import path from "path"

const root = path.resolve(import.meta.dir, "..")
const review = path.join(root, "RELEASE_REVIEW.md")
const changelog = path.join(root, "UPCOMING_CHANGELOG.md")
const version = Bun.argv[2] ?? "patch"

if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
  console.log(`Usage: ./script/release.ts [major|minor|patch|version]

Generates release notes and a public API review, opens the result in your
editor, and asks for confirmation before triggering the release workflow.

The editor is selected from $VISUAL, then $EDITOR, and defaults to vim.`)
  process.exit(0)
}

const input = ["major", "minor", "patch"].includes(version)
  ? ["-f", `bump=${version}`]
  : /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(version)
    ? ["-f", `version=${version}`]
    : undefined

if (!input || Bun.argv.length > 3) {
  console.error("Usage: ./script/release.ts [major|minor|patch|version]")
  process.exit(1)
}

process.chdir(root)

console.log("\n=== Generating changelog ===\n")
await rm(review, { force: true })
await $`git fetch origin "+refs/tags/v2.*:refs/tags/v2.*"`
const base = (await $`git tag --list "v2.*" --sort=-version:refname`.text())
  .split("\n")
  .find((tag) => /^v2\.\d+\.\d+$/.test(tag))
if (!base) throw new Error("No stable V2 release tag was found")
console.log(`Comparing ${base}..HEAD`)
await generateReview(base)

if (!(await Bun.file(review).exists())) throw new Error("OpenCode did not create RELEASE_REVIEW.md")

const editor = Bun.spawn(["sh", "-c", 'exec ${VISUAL:-${EDITOR:-vim}} "$1"', "release", review], {
  cwd: root,
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
if ((await editor.exited) !== 0) {
  console.error("Release cancelled because the editor exited with an error")
  process.exit(1)
}

const document = await Bun.file(review).text()
const notes = document.match(/<!-- changelog:start -->\s*([\s\S]*?)\s*<!-- changelog:end -->/)
if (!notes) throw new Error("Release review is missing its changelog markers")
await Bun.write(changelog, `${notes[1].trim()}\n`)

const answer = prompt(`Trigger the ${version} release? [y/N]`)
if (answer?.trim().toLowerCase() !== "y" && answer?.trim().toLowerCase() !== "yes") {
  console.log("Release cancelled")
  process.exit(0)
}

await $`gh workflow run publish.yml --ref v2 ${input}`
console.log(`Triggered the ${version} release`)

async function generateReview(base: string) {
  const endpoint = await Service.ensure()
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(endpoint),
    fetch: ((request: RequestInfo | URL, init?: RequestInit) =>
      fetch(request, { ...init, timeout: false } as BunFetchRequestInit)) as typeof fetch,
  })
  const controller = new AbortController()
  const events = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
  const connected = await events.next()
  if (connected.done) throw new Error("OpenCode event stream disconnected")

  const session = await client.session.create({
    title: `Review ${version} release`,
    location: { directory: root },
    model: { providerID: "opencode", id: "gpt-5.6-sol", variant: "low" },
    permissions: [
      { action: "*", resource: "*", effect: "deny" },
      { action: "read", resource: "*", effect: "allow" },
      { action: "glob", resource: "*", effect: "allow" },
      { action: "grep", resource: "*", effect: "allow" },
      { action: "shell", resource: "git *", effect: "allow" },
      { action: "shell", resource: "gh *", effect: "allow" },
    ],
  })

  const completed = (async () => {
    while (true) {
      const next = await events.next()
      if (next.done) throw new Error("OpenCode event stream disconnected during release review")
      if (!("sessionID" in next.value.data) || next.value.data.sessionID !== session.id) continue
      if (next.value.type === "session.execution.succeeded") return
      if (next.value.type === "session.execution.failed") throw new Error(next.value.data.error.message)
      if (next.value.type === "session.execution.interrupted")
        throw new Error(`OpenCode release review was interrupted: ${next.value.data.reason}`)
    }
  })()

  try {
    await client.session.prompt({ sessionID: session.id, text: reviewPrompt(base) })
    await completed
    const messages = await client.message.list({ sessionID: session.id, limit: 100, order: "desc" })
    const response = messages.data.find((message) => message.type === "assistant")
    const text = response?.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    if (!text) throw new Error("OpenCode did not return a release review")
    await Bun.write(review, text)
  } finally {
    controller.abort()
    await events.return?.()
  }
}

function reviewPrompt(base: string) {
  return `Create a concise pre-release review for a maintainer.

The previous stable V2 release is ${base}. Inspect every relevant commit and actual diff in the exact range ${base}..HEAD.
Do not compare against dev, V1 release tags, or commits outside that range. Do not rely only on commit titles. Write a
user-facing changelog with sections for Core, TUI, Desktop, SDK, and Extensions, omitting empty sections and changes that
are entirely internal. Group bug fixes separately from improvements. Preserve community contributor attribution when it
is available from merged pull requests.

Put the complete editable changelog between these markers, which must each appear exactly once outside code fences:

## Changelog

<!-- changelog:start -->
...changelog...
<!-- changelog:end -->

Then add a "## Public surface audit" with "### HTTP API", "### Plugin API", and "### Other risks". Report added,
removed, or changed public HTTP routes, schemas, generated client methods, plugin hooks, plugin methods, RPC and tool
contracts, plus any other compatibility risk. Name each affected route or symbol and explain its impact. Write
"None found." under groups without changes. This is an audit, not a second changelog.

Return only the complete Markdown review in your response. Do not modify any files.`
}
