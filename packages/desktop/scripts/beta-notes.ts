// The user-facing changes compiled into a beta build: the build's commit, the newest commits of its history, and the
// feat, fix and perf commits among them, with who made each and what its pull request says it does when GitHub can be
// asked. electron.vite.config.ts embeds them in the renderer as import.meta.env.OPENCODE_BETA_NOTES; the updater's
// "What's new in beta" dialog lists the ones after the commit of the build the user saw last.
// Usage: GITHUB_TOKEN=... bun scripts/beta-notes.ts [head]
export * as BetaNotes from "./beta-notes"

import { execFileSync } from "node:child_process"
import { Option, Schema } from "effect"
import { BetaVisual } from "./beta-visual"

export type BetaNote = {
  type: "feat" | "fix" | "perf"
  scope?: string
  summary: string
  breaking?: true
  pr?: number
  sha: string
  /** The commit's author, or the pull request's once GitHub has been asked. */
  author?: { name: string; login?: string; avatar?: string }
  /** A sentence or two from the pull request's description of what it does. */
  description?: string
  /** The pull request's "### Visual": a small looping SVG of the change, rebuilt, and its still for reduced motion. */
  visual?: { animated: string; still: string }
}

/** How many commits of history a build carries. A previous build further back shows the newest notes instead. */
const LIMIT = 200

/** Commits are identified by this many hex digits, enough to be unique in this repository. */
const SHORT = 12

const KEPT = new Set(["feat", "fix", "perf"])

const FIELD = "\x1f"

const RECORD = "\x1e"

const REPOSITORY = { owner: "anomalyco", name: "opencode" }

/** Pull requests per GitHub query; the newest 200 commits take at most two. */
const BATCH = 100

/** A description longer than this reads as a wall of text in the dialog, so it is cut to fit. */
const DESCRIPTION = 240

/**
 * Reads the commit `head` resolves to (GITHUB_SHA in CI) and its newest commits, newest first: every commit's short
 * sha, merges included so a previous build at a merge is found, and the notes of the non-merge feat, fix and perf ones.
 */
export function embed(input: { head?: string; cwd?: string } = {}) {
  // electron-vite loads its config, which calls this, in Node, so this cannot use Bun's shell.
  const git = (...args: string[]) => execFileSync("git", args, { cwd: input.cwd, encoding: "utf8" })

  const sha = git("rev-parse", input.head ?? process.env.GITHUB_SHA ?? "HEAD").trim()

  const log = git(
    "log",
    "--topo-order",
    `--max-count=${LIMIT}`,
    `--format=%H${FIELD}%P${FIELD}%an${FIELD}%s${RECORD}`,
    sha,
  )

  const records = log
    .split(RECORD)
    .map((record) => record.trim().split(FIELD))
    .filter((fields) => fields.length === 4 && fields[0])

  return {
    sha,
    commits: records.map(([commit]) => commit!.slice(0, SHORT)),
    notes: records.flatMap(([commit, parents, author, subject]): BetaNote[] => {
      // A merge commit repeats the commits it merges.
      if (parents!.trim().split(/\s+/).length > 1) return []

      const note = parseSubject(subject!)

      if (!note) return []

      return [{ ...note, sha: commit!.slice(0, SHORT), author: author!.trim() ? { name: author!.trim() } : undefined }]
    }),
  }
}

/**
 * Adds each note's pull request author (name, login and public avatar) and description, read from GitHub with one
 * GraphQL query per 100 pull requests. The token stays here: only public data reaches the build. Without a token, or
 * when GitHub fails or is slow, the notes keep their commit author and subject: a build never fails for this.
 */
export async function enrich(
  embedded: ReturnType<typeof embed>,
  input: { token: string | undefined; fetch?: Request },
): Promise<ReturnType<typeof embed>> {
  const numbers = [...new Set(embedded.notes.flatMap((note) => note.pr ?? []))]
  const token = input.token

  if (!token || numbers.length === 0) return embedded

  const batches = Array.from({ length: Math.ceil(numbers.length / BATCH) }, (_, i) =>
    numbers.slice(i * BATCH, (i + 1) * BATCH),
  )

  const found = new Map(
    (await Promise.all(batches.map((batch) => pullRequests(batch, token, input.fetch ?? fetch)))).flat(),
  )

  return {
    ...embedded,
    notes: embedded.notes.map((note) => {
      const pr = note.pr === undefined ? undefined : found.get(note.pr)

      if (!pr) return note

      return {
        ...note,
        author: pr.author ? author(pr.author) : note.author,
        description: describe(pr.body, note.summary),
        visual: visual(pr.body),
      }
    }),
  }
}

/**
 * The first sentence or two of what a pull request says it does, as plain text: from the PR template's "What does this
 * PR do?" or a "Summary" section, else the text before the first heading, else a "Changes" or "Solution" section. The
 * template's own lines (issue links, "N/A", the type-of-change checklist) never count. Text over the cap ends at its
 * last whole sentence that fits, or is cut at a word with an ellipsis. None when it only repeats the subject.
 */
export function describe(body: string, summary: string) {
  const heading = (line: string) => /^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line)

  // Template headings stay, as they end the section before them.
  const lines = body
    .replace(/<!--[\s\S]*?-->|```[\s\S]*?```/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => heading(line) || !BOILERPLATE.some((pattern) => pattern.test(line)))

  const until = (rest: string[]) => {
    const end = rest.findIndex(heading)

    return end === -1 ? rest : rest.slice(0, end)
  }

  const section = (title: RegExp) => {
    const start = lines.findIndex((line) => heading(line) && title.test(line))

    return start === -1 ? [] : until(lines.slice(start + 1))
  }

  const words = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()

  return [section(/what does this pr do|summary/i), until(lines), section(/^\W*(what )?chang|solution/i)]
    .map((candidate) => {
      const paragraph = candidate
        .join("\n")
        .split(/\n\s*\n/)
        // A list stands for its first item.
        .map((block) => plain(block.split("\n").find((line) => /^([-*+]|\d+\.)\s/.test(line)) ?? block))
        .find(
          (text) => text && !/^(\[.\]|(closes|fixes|resolves|stacked on|depends on|n\/a|please provide)\b)/i.test(text),
        )

      // A sentence that introduces a code block or a list reads as cut off.
      const [first, second] = (paragraph ?? "")
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(])/)
        .filter((sentence) => sentence && !sentence.endsWith(":"))

      const text = first && second && `${first} ${second}`.length <= DESCRIPTION ? `${first} ${second}` : first

      // Fragments of a list, or text that starts with code, don't read as a sentence on their own.
      return text && /^[A-Z0-9"“]/.test(text) && words(text) !== words(summary) ? cap(text) : undefined
    })
    .find((text) => text !== undefined)
}

/**
 * The ```svg block under a pull request's "### Visual" heading, rebuilt from an allowlist (beta-visual.ts) as an
 * animated and a still copy. The dialog only ever shows it as an image, where scripts never run.
 */
export function visual(body: string) {
  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((line) => /^#{1,6}\s+visual\b/i.test(line.trim()))

  if (start === -1) return undefined

  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line.trim()))
  const block = (end === -1 ? rest : rest.slice(0, end)).join("\n").match(/```svg[^\n]*\n([\s\S]*?)\n\s*```/)?.[1]

  return block ? BetaVisual.sanitize(block) : undefined
}

/** Lines of the PR template that say nothing about the change, whether a heading, a label or a filler answer. */
const BOILERPLATE = [
  /^\W*(issue for this pr|type of change|how did you verify|screenshots|checklist)\b/i,
  /^[-*+]\s*\[[ x]\]/i,
  /^\W*(n\/a|none|tbd)\W*$/i,
  /^\W*((closes|fixes|resolves)\s*)?([\w.-]+\/[\w.-]+)?#\d*\W*$/i,
]

/** A sentence over the cap, cut at its last word that fits, with an ellipsis. */
function cap(text: string) {
  if (text.length <= DESCRIPTION) return text

  const cut = text.slice(0, DESCRIPTION - 1).replace(/\s+\S*$/, "")

  return `${cut.replace(/[\s,;:—–-]+$/, "")}…`
}

/** Markdown as the plain text it reads as. */
function plain(markdown: string) {
  return (
    markdown
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // Parenthesized file paths and identifiers are for reviewers.
      .replace(/\s*\([^()]*`[^()]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/^\s*(?:[-*+]|\d+\.|>)\s+/gm, "")
      .replace(/(\*\*|__|`)/g, "")
      .replace(/\s+/g, " ")
      .trim()
  )
}

const Author = Schema.Struct({
  login: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  name: Schema.optional(Schema.NullOr(Schema.String)),
})

const PullRequest = Schema.Struct({ number: Schema.Number, body: Schema.String, author: Schema.NullOr(Author) })

const Response = Schema.Struct({
  data: Schema.Struct({ repository: Schema.Record(Schema.String, Schema.NullOr(PullRequest)) }),
})

const decodeResponse = Schema.decodeUnknownOption(Response)

type Request = (url: string, init: RequestInit) => Promise<globalThis.Response>

/** The pull requests GitHub returns for `numbers`; none when the request fails. Missing numbers are left out. */
async function pullRequests(numbers: number[], token: string, request: Request) {
  const fields = numbers
    .map(
      (n) =>
        `pr${n}: pullRequest(number: ${n}) { number body author { login avatarUrl(size: 48) ... on User { name } } }`,
    )
    .join("\n")

  const query = `query { repository(owner: "${REPOSITORY.owner}", name: "${REPOSITORY.name}") { ${fields} } }`

  const response = await request("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "opencode-desktop" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000),
  })
    .then((result) => (result.ok ? result.json() : undefined))
    .catch(() => undefined)

  return Option.match(decodeResponse(response), {
    onNone: () => [],
    onSome: (decoded) => Object.values(decoded.data.repository).flatMap((pr) => (pr ? [[pr.number, pr] as const] : [])),
  })
}

/** A pull request author as the dialog shows them; only GitHub's public avatar host is kept. */
function author(input: typeof Author.Type): NonNullable<BetaNote["author"]> {
  const avatar = input.avatarUrl?.startsWith("https://avatars.githubusercontent.com/") ? input.avatarUrl : undefined

  return { name: input.name?.trim() || input.login, login: input.login, avatar }
}

/** Parses a conventional commit header `type(scope)!: summary (#123)`; anything else is not a note. */
export function parseSubject(subject: string) {
  const match = subject.trim().match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/)
  const type = match?.[1]?.toLowerCase()

  if (!match || !type || !isKept(type)) return undefined

  const pr = match[4]!.match(/\s*\(#(\d+)\)\s*$/)
  const summary = (pr ? match[4]!.slice(0, pr.index) : match[4]!).trim()

  if (!summary) return undefined

  const note: Omit<BetaNote, "sha"> = { type, summary }
  const scope = match[2]?.trim()

  if (scope) note.scope = scope

  if (match[3]) note.breaking = true

  if (pr) note.pr = Number(pr[1])

  return note
}

function isKept(type: string): type is BetaNote["type"] {
  return KEPT.has(type)
}

if (import.meta.main)
  console.log(
    JSON.stringify(await enrich(embed({ head: process.argv[2] }), { token: process.env.GITHUB_TOKEN }), null, 2),
  )
