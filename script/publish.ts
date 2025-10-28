#!/usr/bin/env bun

import { $ } from "bun"
import { createOpencode } from "@opencode-ai/sdk"
import { Script } from "@opencode-ai/script"

const notes = [] as string[]

console.log("=== publishing ===\n")

if (!Script.preview) {
  const previous = await fetch("https://registry.npmjs.org/opencode-ai/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.version)

  const log =
    await $`git log v${previous}..HEAD --oneline --format="%h %s" -- packages/opencode packages/sdk packages/plugin`.text()

  const commits = log
    .split("\n")
    .filter((line) => line && !line.match(/^\w+ (ignore:|test:|chore:)/i))
    .join("\n")

  const opencode = await createOpencode()
  const session = await opencode.client.session.create()
  console.log("generating changelog since " + previous)
  const raw = await opencode.client.session
    .prompt({
      path: {
        id: session.data!.id,
      },
      body: {
        model: {
          providerID: "opencode",
          modelID: "kimi-k2",
        },
        parts: [
          {
            type: "text",
            text: `
          Analyze these commits and generate a changelog of all notable user facing changes.

          Commits between ${previous} and HEAD:
          ${commits}

          - Do NOT make general statements about "improvements", be very specific about what was changed.
          - Do NOT include any information about code changes if they do not affect the user facing changes.
          - For commits that are already well-written and descriptive, avoid rewording them. Simply capitalize the first letter, fix any misspellings, and ensure proper English grammar.

          IMPORTANT: ONLY return a bulleted list of changes, do not include any other information. Do not include a preamble like "Based on my analysis..."

          <example>
          - Added ability to @ mention agents
          - Fixed a bug where the TUI would render improperly on some terminals
          </example>
          `,
          },
        ],
      },
    })
    .then((x) => x.data?.parts?.find((y) => y.type === "text")?.text)
  for (const line of raw?.split("\n") ?? []) {
    if (line.startsWith("- ")) {
      notes.push(line)
    }
  }
  console.log(notes)
  opencode.server.close()
}

const pkgjsons = await Array.fromAsync(
  new Bun.Glob("**/package.json").scan({
    absolute: true,
  }),
).then((arr) => arr.filter((x) => !x.includes("node_modules") && !x.includes("dist")))

for (const file of pkgjsons) {
  let pkg = await Bun.file(file).text()
  pkg = pkg.replaceAll(/"version": "[^"]+"/g, `"version": "${Script.version}"`)
  console.log("updated:", file)
  await Bun.file(file).write(pkg)
}
await $`bun install`

console.log("\n=== opencode ===\n")
await import(`../packages/opencode/script/publish.ts`)

console.log("\n=== sdk ===\n")
await import(`../packages/sdk/js/script/publish.ts`)

console.log("\n=== plugin ===\n")
await import(`../packages/plugin/script/publish.ts`)

const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)

if (!Script.preview) {
  await $`git commit -am "release: v${Script.version}"`
  await $`git tag v${Script.version}`
  await $`git fetch origin`
  await $`git cherry-pick HEAD..origin/dev`.nothrow()
  await $`git push origin HEAD --tags --no-verify --force-with-lease`
  await $`gh release create v${Script.version} --title "v${Script.version}" --notes ${notes.join("\n") ?? "No notable changes"} ./packages/opencode/dist/*.zip`
}
