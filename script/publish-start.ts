#!/usr/bin/env bun

import { $ } from "bun"
import { createOpencode } from "@opencode-ai/sdk"
import { Script } from "@opencode-ai/script"

const notes = [] as string[]

console.log("=== publishing ===\n")

if (!Script.preview) {
  const previous = await fetch("https://api.github.com/repos/sst/opencode/releases/latest")
    .then((res) => {
      if (!res.ok) throw new Error(res.statusText)
      return res.json()
    })
    .then((data: any) => data.tag_name.replace(/^v/, ""))

  const log =
    await $`git log v${previous}..HEAD --oneline --format="%h %s" -- packages/opencode packages/sdk packages/plugin packages/desktop packages/app`.text()

  const commits = log.split("\n").filter((line) => line && !line.match(/^\w+ (ignore:|test:|chore:|ci:)/i))

  const team = [
    "actions-user",
    "opencode",
    "rekram1-node",
    "thdxr",
    "kommander",
    "jayair",
    "fwang",
    "adamdotdevin",
    "iamdavidhill",
    "opencode-agent[bot]",
  ]

  async function generateChangelog() {
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
            modelID: "claude-sonnet-4-5",
          },
          parts: [
            {
              type: "text",
              text: `
            Analyze these commits and generate a changelog of all notable user facing changes, grouped by area.

            Each commit below includes:
            - [author: username] showing the GitHub username of the commit author
            - [areas: ...] showing which areas of the codebase were modified

            Commits between ${previous} and HEAD:
            ${commits.join("\n")}

            Group the changes into these categories based on the [areas: ...] tags (omit any category with no changes):
            - **TUI**: Changes to "opencode" area (the terminal/CLI interface)
            - **Desktop**: Changes to "app" or "tauri" areas (the desktop application)
            - **SDK**: Changes to "sdk" or "plugin" areas (the SDK and plugin system)
            - **Extensions**: Changes to "extensions/zed", "extensions/vscode", or "github" areas (editor extensions and GitHub Action)
            - **Other**: Any user-facing changes that don't fit the above categories

            Excluded areas (omit these entirely unless they contain user-facing changes like refactors that may affect behavior):
            - "nix", "infra", "script" - CI/build infrastructure
            - "ui", "docs", "web", "console", "enterprise", "function", "util", "identity", "slack" - internal packages

            Rules:
            - Use the [areas: ...] tags to determine the correct category. If a commit touches multiple areas, put it in the most relevant user-facing category.
            - ONLY include commits that have user-facing impact. Omit purely internal changes (CI, build scripts, internal tooling).
            - However, DO include refactors that touch user-facing code - refactors can introduce bugs or change behavior.
            - Do NOT make general statements about "improvements", be very specific about what was changed.
            - For commits that are already well-written and descriptive, avoid rewording them. Simply capitalize the first letter, fix any misspellings, and ensure proper English grammar.
            - DO NOT read any other commits than the ones listed above (THIS IS IMPORTANT TO AVOID DUPLICATING THINGS IN OUR CHANGELOG).
            - If a commit was made and then reverted do not include it in the changelog. If the commits only include a revert but not the original commit, then include the revert in the changelog.
            - Omit categories that have no changes.
            - For community contributors: if the [author: username] is NOT in the team list, add (@username) at the end of the changelog entry. This is REQUIRED for all non-team contributors.
            - The team members are: ${team.join(", ")}. Do NOT add @ mentions for team members.

            IMPORTANT: ONLY return the grouped changelog, do not include any other information. Do not include a preamble like "Based on my analysis..." or "Here is the changelog..."

            <example>
            ## TUI
            - Added experimental support for the Ty language server (@OpeOginni)
            - Added /fork slash command for keyboard-friendly session forking (@ariane-emory)
            - Increased retry attempts for failed requests
            - Fixed model validation before executing slash commands (@devxoul)

            ## Desktop
            - Added shell mode support
            - Fixed prompt history navigation and optimistic prompt duplication
            - Disabled pinch-to-zoom on Linux (@Brendonovich)

            ## Extensions
            - Added OIDC_BASE_URL support for custom GitHub App installations (@elithrar)
            </example>
          `,
            },
          ],
        },
      })
      .then((x) => x.data?.parts?.find((y) => y.type === "text")?.text)
    opencode.server.close()
    return raw
  }

  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000))
  const raw = await Promise.race([generateChangelog(), timeout])

  if (raw) {
    for (const line of raw.split("\n")) {
      if (line.startsWith("- ")) {
        notes.push(line)
      }
    }
    console.log("---- Generated Changelog ----")
    console.log(notes.join("\n"))
    console.log("-----------------------------")
  } else {
    console.log("Changelog generation timed out, using raw commits")
    for (const commit of commits) {
      const message = commit.replace(/^\w+ /, "")
      notes.push(`- ${message}`)
    }
  }

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

let output = `version=${Script.version}\n`

if (!Script.preview) {
  await $`git commit -am "release: v${Script.version}"`
  await $`git tag v${Script.version}`
  await $`git fetch origin`
  await $`git cherry-pick HEAD..origin/dev`.nothrow()
  await $`git push origin HEAD --tags --no-verify --force-with-lease`
  await new Promise((resolve) => setTimeout(resolve, 5_000))
  await $`gh release create v${Script.version} -d --title "v${Script.version}" --notes ${notes.join("\n") || "No notable changes"} ./packages/opencode/dist/*.zip ./packages/opencode/dist/*.tar.gz`
  const release = await $`gh release view v${Script.version} --json id,tagName`.json()
  output += `release=${release.id}\n`
  output += `tag=${release.tagName}\n`
}

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, output)
}
