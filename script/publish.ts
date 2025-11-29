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
    .filter((line) => line && !line.match(/^\w+ (ignore:|test:|chore:|ci:)/i))
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
          modelID: "claude-haiku-4-5",
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
          - DO NOT read any other commits than the ones listed above (THIS IS IMPORTANT TO AVOID DUPLICATING THINGS IN OUR CHANGELOG)
          - If a commit was made and then reverted do not include it in the changelog. If the commits only include a revert but not the original commit, then include the revert in the changelog.

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
  console.log("---- Generated Changelog ----")
  console.log(notes.join("\n"))
  console.log("-----------------------------")
  opencode.server.close()

  // Get contributors
  const team = [
    "actions-user",
    "opencode",
    "rekram1-node",
    "thdxr",
    "kommander",
    "jayair",
    "fwang",
    "adamdotdevin",
    "opencode-agent[bot]",
  ]
  const compare =
    await $`gh api "/repos/sst/opencode/compare/v${previous}...HEAD" --jq '.commits[] | {login: .author.login, message: .commit.message}'`.text()
  const contributors = new Map<string, string[]>()

  for (const line of compare.split("\n").filter(Boolean)) {
    const { login, message } = JSON.parse(line) as { login: string | null; message: string }
    const title = message.split("\n")[0] ?? ""
    if (title.match(/^(ignore:|test:|chore:|ci:|release:)/i)) continue

    if (login && !team.includes(login)) {
      if (!contributors.has(login)) contributors.set(login, [])
      contributors.get(login)?.push(title)
    }
  }

  if (contributors.size > 0) {
    notes.push("")
    notes.push(`**Thank you to ${contributors.size} community contributor${contributors.size > 1 ? "s" : ""}:**`)
    for (const [username, userCommits] of contributors) {
      notes.push(`- @${username}:`)
      for (const commit of userCommits) {
        notes.push(`  - ${commit}`)
      }
    }
  }
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

const extensionToml = new URL("../packages/extensions/zed/extension.toml", import.meta.url).pathname
let toml = await Bun.file(extensionToml).text()
toml = toml.replace(/^version = "[^"]+"/m, `version = "${Script.version}"`)
toml = toml.replaceAll(/releases\/download\/v[^/]+\//g, `releases/download/v${Script.version}/`)
console.log("updated:", extensionToml)
await Bun.file(extensionToml).write(toml)

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
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`gh release create v${Script.version} --title "v${Script.version}" --notes ${notes.join("\n") ?? "No notable changes"} ./packages/opencode/dist/*.zip ./packages/opencode/dist/*.tar.gz`
}
