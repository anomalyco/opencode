import path from "path"

export type Highlight = { title: string; body: string }

const LIMIT = { releases: 5, items: 5, title: 60, body: 300 }

/**
 * Extracts the `### Highlights` bullets from reviewed release notes. Each bullet is expected to look like
 * `- **Title**: One or two sentences. ([#123](https://github.com/...))`; trailing pull request links are dropped and
 * inline Markdown is reduced to plain text, keeping backticks for code spans. Problems are reported instead of thrown
 * so a formatting mistake never fails a release build.
 */
export function parse(notes: string) {
  const problems: string[] = []
  const lines = notes.replace(/\r\n/g, "\n").split("\n")
  const start = lines.findIndex((line) => /^###\s+Highlights\s*$/i.test(line.trim()))
  if (start === -1) return { items: [] as Highlight[], problems }
  const end = lines.findIndex((line, index) => index > start && /^#{1,3}\s/.test(line))
  const bullets = lines.slice(start + 1, end === -1 ? undefined : end).reduce(
    (state, line) => {
      if (line.trim().startsWith("```")) return { ...state, fenced: !state.fenced }
      if (state.fenced) return state
      const bullet = line.match(/^[-*]\s+(.*)$/)
      if (bullet) return { ...state, items: [...state.items, bullet[1]] }
      if (state.items.length && /^\s+\S/.test(line))
        return { ...state, items: [...state.items.slice(0, -1), `${state.items.at(-1)} ${line.trim()}`] }
      return state
    },
    { fenced: false, items: [] as string[] },
  ).items

  const items = bullets.flatMap((bullet) => {
    const match = bullet.match(/^\*\*(.+?)\*\*:?\s*(.*)$/)
    const title = match && plain(match[1].replace(/:$/, ""))
    const body = match && plain(match[2].replace(/\s*\((?:\[[^\]]*\]\([^)]*\)(?:,\s*)?)+\)\s*$/, ""))
    if (!title || !body) {
      problems.push(`Skipped a highlight without a bold title and description: ${bullet.slice(0, 80)}`)
      return []
    }
    return [{ title: truncate(title, LIMIT.title), body: truncate(body, LIMIT.body) }]
  })

  if (items.length > LIMIT.items) problems.push(`Kept the first ${LIMIT.items} of ${items.length} highlights`)
  if (!items.length) problems.push("The Highlights section has no highlights in the expected format")
  return { items: items.slice(0, LIMIT.items), problems }
}

function plain(value: string) {
  return value
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function truncate(value: string, limit: number) {
  if (value.length <= limit) return value
  const cut = value.slice(0, limit - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * Splits CHANGELOG.md at its `## vX.Y.Z` release headings and parses each release's Highlights. Returns the newest
 * releases that have highlights, newest first, with the problems in the newest release's notes only: older releases
 * have shipped, so their problems are no longer actionable.
 */
export function history(changelog: string) {
  const sections = changelog
    .replace(/\r\n/g, "\n")
    .split(/^(?=## v\d+\.\d+\.\d+(?:\s|$))/m)
    .flatMap((section) => {
      const version = section.match(/^## v(\d+\.\d+\.\d+)(?:\s|$)/)?.[1]
      return version ? [{ version, ...parse(section) }] : []
    })
  return {
    releases: sections
      .filter((section) => section.items.length > 0)
      .slice(0, LIMIT.releases)
      .map((section) => ({ version: section.version, items: section.items })),
    problems: sections[0]?.problems ?? [],
  }
}

/**
 * Returns the JSON a stable release build embeds as `OPENCODE_RELEASE_HIGHLIGHTS`: the newest releases' highlights
 * from the repository's CHANGELOG.md, which the release commit has already extended with this release's notes.
 */
export async function embed() {
  const result = history(await Bun.file(path.resolve(import.meta.dir, "../../../CHANGELOG.md")).text())
  result.problems.forEach((problem) => console.warn(`release highlights: ${problem}`))
  if (!result.releases.length) return
  return JSON.stringify(result.releases)
}
