#!/usr/bin/env bun

import { $ } from "bun"
import { createOpencode } from "@opencode-ai/sdk"

const TEAM = [
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

const MODEL = "gemini-3-flash"

function getAreaFromPath(file: string): string {
  if (file.startsWith("packages/")) {
    const parts = file.replace("packages/", "").split("/")
    if (parts[0] === "extensions" && parts[1]) return `extensions/${parts[1]}`
    return parts[0] || "other"
  }
  if (file.startsWith("sdks/")) {
    const name = file.replace("sdks/", "").split("/")[0] || "other"
    return `extensions/${name}`
  }
  const rootDir = file.split("/")[0]
  if (rootDir && !rootDir.includes(".")) return rootDir
  return "other"
}

function buildPrompt(previous: string, commits: string): string {
  return `
Analyze these commits and generate a changelog of all notable user facing changes, grouped by area.

Each commit below includes:
- [author: username] showing the GitHub username of the commit author
- [areas: ...] showing which areas of the codebase were modified

Commits between ${previous} and HEAD:
${commits}

Group the changes into these categories based on the [areas: ...] tags (omit any category with no changes):
- **TUI**: Changes to "opencode" area (the terminal/CLI interface)
- **Desktop**: Changes to "desktop" or "tauri" areas (the desktop application)
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
- The team members are: ${TEAM.join(", ")}. Do NOT add @ mentions for team members.

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
`
}

function parseChangelog(raw: string): string[] {
  const lines: string[] = []
  for (const line of raw.split("\n")) {
    if (line.startsWith("## ")) {
      if (lines.length > 0) lines.push("")
      lines.push(line)
    } else if (line.startsWith("- ")) {
      lines.push(line)
    }
  }
  return lines
}

function formatContributors(contributors: Map<string, string[]>): string[] {
  if (contributors.size === 0) return []
  const lines: string[] = []
  lines.push("")
  lines.push(`**Thank you to ${contributors.size} community contributor${contributors.size > 1 ? "s" : ""}:**`)
  for (const username of contributors.keys()) {
    lines.push(`- @${username}`)
  }
  return lines
}

/**
 * Generates a changelog for a release.
 *
 * Uses GitHub API for commit authors, git for file changes,
 * and Gemini Flash via opencode SDK for changelog generation.
 *
 * @param previous - The previous version tag (e.g. "v1.0.167")
 * @param current - The current ref (e.g. "HEAD" or "v1.0.168")
 * @returns Formatted changelog string ready for GitHub release notes
 */
export async function generateChangelog(previous: string, current: string): Promise<string> {
  // Fetch commit authors from GitHub API (hash -> login)
  const compare =
    await $`gh api "/repos/sst/opencode/compare/${previous}...${current}" --jq '.commits[] | {sha: .sha, login: .author.login, message: .commit.message}'`
      .text()
      .catch(() => "")

  const authorByHash = new Map<string, string>()
  const contributors = new Map<string, string[]>()

  for (const line of compare.split("\n").filter(Boolean)) {
    const { sha, login, message } = JSON.parse(line) as { sha: string; login: string | null; message: string }
    if (login) authorByHash.set(sha, login)

    const title = message.split("\n")[0] || ""
    if (title.match(/^(ignore:|test:|chore:|ci:|release:)/i)) continue
    if (login && !TEAM.includes(login)) {
      if (!contributors.has(login)) contributors.set(login, [])
      contributors.get(login)?.push(title)
    }
  }

  function findAuthor(shortHash: string): string | undefined {
    for (const [sha, login] of authorByHash) {
      if (sha.startsWith(shortHash)) return login
    }
  }

  // Batch-fetch files for all commits (hash -> areas)
  const diffLog = await $`git log ${previous}..${current} --name-only --format="%h"`.text()
  const areasByHash = new Map<string, Set<string>>()
  let currentHash: string | null = null

  for (const rawLine of diffLog.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^[0-9a-f]{7,}$/i.test(line) && !line.includes("/")) {
      currentHash = line
      if (!areasByHash.has(currentHash)) areasByHash.set(currentHash, new Set())
      continue
    }
    if (currentHash) {
      areasByHash.get(currentHash)!.add(getAreaFromPath(line))
    }
  }

  // Build commit lines with author and areas
  const log = await $`git log ${previous}..${current} --oneline --format="%h %s"`.text()
  const commitLines = log.split("\n").filter((line) => line && !line.match(/^\w+ (ignore:|test:|chore:|ci:|release:)/i))

  const commitsWithMeta = commitLines
    .map((line) => {
      const hash = line.split(" ")[0]
      if (!hash) return null
      const author = findAuthor(hash)
      const authorStr = author ? ` [author: ${author}]` : ""
      const areas = areasByHash.get(hash)
      const areaStr = areas && areas.size > 0 ? ` [areas: ${[...areas].join(", ")}]` : " [areas: other]"
      return `${line}${authorStr}${areaStr}`
    })
    .filter(Boolean) as string[]

  const commits = commitsWithMeta.join("\n")

  // Generate changelog via LLM
  // different port to not conflict with dev running opencode
  const opencode = await createOpencode({ port: 8192 })
  let raw: string | undefined
  try {
    const session = await opencode.client.session.create()
    raw = await opencode.client.session
      .prompt({
        path: { id: session.data!.id },
        body: {
          model: { providerID: "opencode", modelID: MODEL },
          parts: [{ type: "text", text: buildPrompt(previous, commits) }],
        },
      })
      .then((x) => x.data?.parts?.find((y) => y.type === "text")?.text)
  } finally {
    opencode.server.close()
  }

  const notes = parseChangelog(raw ?? "")
  notes.push(...formatContributors(contributors))

  return notes.join("\n")
}

// Standalone runner for local testing
if (import.meta.main) {
  const [previous, current] = process.argv.slice(2)
  if (!previous || !current) {
    console.error("Usage: bun script/changelog.ts <previous> <current>")
    console.error("Example: bun script/changelog.ts v1.0.167 HEAD")
    process.exit(1)
  }
  const changelog = await generateChangelog(previous, current)
  console.log(changelog)
  process.exit(0)
}
