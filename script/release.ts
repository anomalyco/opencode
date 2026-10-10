#!/usr/bin/env bun

import { $ } from "bun"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { rm } from "fs/promises"
import path from "path"
import { parseArgs } from "util"

const root = path.resolve(import.meta.dir, "..")
const review = path.join(root, "RELEASE_REVIEW.md")
const changelog = path.join(root, "UPCOMING_CHANGELOG.md")
const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    from: { type: "string", short: "f" },
    to: { type: "string", short: "t", default: "HEAD" },
    print: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
})
const version = positionals[0] ?? "patch"

if (values.help) {
  console.log(`Usage: ./script/release.ts [major|minor|patch|version]
       ./script/release.ts --print [--from <tag>] [--to <ref>]

Generates release notes and a public API review, opens the result in your
editor, and asks for confirmation before triggering the release workflow.

The editor is selected from $VISUAL, then $EDITOR, and defaults to vim.

Options:
  -f, --from <tag>   Previous release tag (default: latest stable V2 tag)
  -t, --to <ref>     Ending ref (default: HEAD)
      --print        Print the generated review and exit without releasing`)
  process.exit(0)
}

const input = ["major", "minor", "patch"].includes(version)
  ? ["-f", `bump=${version}`]
  : /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(version)
    ? ["-f", `version=${version}`]
    : undefined

if (!input || positionals.length > 1 || (!values.print && (values.from || values.to !== "HEAD"))) {
  console.error("Usage: ./script/release.ts [major|minor|patch|version]")
  console.error("       ./script/release.ts --print [--from <tag>] [--to <ref>]")
  process.exit(1)
}

process.chdir(root)

console.log("\n=== Generating changelog ===\n")
await rm(review, { force: true })
await $`git fetch origin "+refs/tags/v2.*:refs/tags/v2.*"`
const base =
  values.from ??
  (await $`git tag --list "v2.*" --sort=-version:refname`.text()).split("\n").find((tag) => /^v2\.\d+\.\d+$/.test(tag))
if (!base) throw new Error("No stable V2 release tag was found")
console.log(`Comparing ${base}..${values.to}`)
await generateReview(base, values.to)

if (!(await Bun.file(review).exists())) throw new Error("OpenCode did not create RELEASE_REVIEW.md")
if (values.print) {
  process.stdout.write(await Bun.file(review).text())
  process.exit(0)
}

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
const releaseNotes = notes[1].trim()
if (!releaseNotes) throw new Error("Release review has no changelog")
await Bun.write(changelog, `${releaseNotes}\n`)

const answer = prompt(`Trigger the ${version} release? [y/N]`)
if (answer?.trim().toLowerCase() !== "y" && answer?.trim().toLowerCase() !== "yes") {
  console.log("Release cancelled")
  process.exit(0)
}

await $`gh workflow run publish.yml --ref v2 ${input} -f release_notes=${releaseNotes}`
console.log(`Triggered the ${version} release`)

async function generateReview(base: string, head: string) {
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
    await client.session.prompt({ sessionID: session.id, text: reviewPrompt(base, head) })
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

function reviewPrompt(base: string, head: string) {
  return `Create a concise pre-release review for a maintainer.

The previous stable V2 release is ${base}. Inspect every relevant commit and actual diff in the exact range ${base}..${head}.
Do not compare against dev, V1 release tags, or commits outside that range. Do not rely only on commit titles. Write a
user-facing changelog with sections for Core, TUI, Desktop, SDK, and Extensions, omitting empty sections and changes that
are entirely internal. Group bug fixes separately from improvements. Preserve community contributor attribution when it
is available from merged pull requests, but never thank authors listed in .github/TEAM_MEMBERS.

Start the changelog with a "### Highlights" section: the few changes worth telling people about, written for humans.
Pick 2 to 5 user-visible changes a user would notice, try, or share: new capabilities, clearly better workflows, or fixes
for problems many users hit. Merge related small changes into one highlight. Skip internal work, refactors, tests, CI,
dependency bumps, broad polish without one concrete outcome, and anything not usable in this release. When nothing
qualifies, omit the section instead of padding it. Order highlights by how much users will care.

Before writing a highlight, read its pull request with gh pr view and confirm the behavior in the diff. Name the exact
command, flag, setting, or place in the UI, and describe how to use it as the pull request does. Never invent, guess, or
embellish, and avoid vague claims like "better" or "more naturally". Write each highlight as one bullet with a few-word
Title Case title (lowercase short words like "and" or "to"), then one or two plain sentences in second person about what
you can now do and why it matters. Vary the sentence openings, and leave contributor thanks to the detailed
sections. For example:

- **Reopen Closed Tabs**: Right-click the new-session button in the tab bar to bring back a session you closed by
  mistake. ([#123](https://github.com/anomalyco/opencode/pull/123))

Every highlight must also appear in the detailed sections that follow. Use "###" for Highlights and each release section,
"####" for Improvements and Bug fixes, and never use "#" or "##" headings in the changelog, since each release is filed
under its own "##" heading.

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
