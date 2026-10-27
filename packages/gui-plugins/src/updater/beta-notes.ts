import { Option, Schema } from "effect"

const REPOSITORY = "https://github.com/anomalyco/opencode"

/** The dialog lists at most this many changes and links the rest. */
const SHOWN = 10

const Note = Schema.Struct({
  type: Schema.Literals(["feat", "fix", "perf"]),
  summary: Schema.String,
  pr: Schema.optional(Schema.Number),
  sha: Schema.String,
  author: Schema.optional(
    Schema.Struct({
      name: Schema.String,
      login: Schema.optional(Schema.String),
      avatar: Schema.optional(Schema.String),
    }),
  ),
  description: Schema.optional(Schema.String),
  visual: Schema.optional(Schema.Struct({ animated: Schema.String, still: Schema.String })),
})

/** What a beta build embeds (packages/desktop/script/beta-notes.ts), newest first. */
const Embedded = Schema.Struct({
  /** The build's commit. */
  sha: Schema.String,
  /** The short shas of the build's newest commits, merges included. */
  commits: Schema.Array(Schema.String),
  /** The feat, fix and perf commits among them. */
  notes: Schema.Array(Note),
})

export type EmbeddedNotes = typeof Embedded.Type

/** Decodes the notes a beta build embeds as JSON. Other builds embed none. */
export const decodeEmbeddedNotes = Schema.decodeUnknownOption(Schema.fromJsonString(Embedded))

export type BetaNote = {
  readonly sha: string
  readonly type: "feat" | "fix" | "perf"
  readonly summary: string
  /** A sentence or two from the pull request about what it does, read out for its visual. */
  readonly description?: string
  /** A small looping SVG of the change, from the pull request's "### Visual", sanitized at build time. */
  readonly visual?: { readonly animated: string; readonly still: string }
  readonly pr?: { readonly number: number; readonly url: string }
  /** Who made it, with GitHub's public avatar when the build could ask GitHub. */
  readonly author?: { readonly name: string; readonly avatar?: string }
}

export type BetaNotes = {
  /** New features, newest first. */
  readonly added: readonly BetaNote[]
  /** Fixes and performance improvements, newest first. */
  readonly fixed: readonly BetaNote[]
  /** How many changes the header counts: every one since the previous build, or the listed ones when that is unknown. */
  readonly total: number
  /** Some changes since the previous build are not listed. */
  readonly more: boolean
}

/**
 * The changes since the build at `previous`: the notes of the commits newer than it, features first, then fixes, at
 * most 10 in all and at least half of them features when there are enough. When `previous` is older than the embedded
 * history (or was force-pushed away), the newest notes stand in, with the rest on the What's new page. None without a previous commit,
 * or without a change.
 */
export function sliceBetaNotes(embedded: EmbeddedNotes, previous: string | undefined): Option.Option<BetaNotes> {
  if (!previous || previous === embedded.sha) return Option.none()

  const cut = embedded.commits.findIndex((commit) => previous.startsWith(commit))
  const position = new Map(embedded.commits.map((commit, index) => [commit, index]))
  const notes = cut === -1 ? embedded.notes : embedded.notes.filter((note) => (position.get(note.sha) ?? cut) < cut)

  if (notes.length === 0) return Option.none()

  const features = notes.filter((note) => note.type === "feat")
  const fixes = notes.filter((note) => note.type !== "feat")
  // Features get at least half of the list when there are more fixes than fit, fixes whatever features leave.
  const added = features.slice(0, Math.max(SHOWN / 2, SHOWN - fixes.length))
  const fixed = fixes.slice(0, SHOWN - added.length)
  const listed = added.length + fixed.length

  return Option.some({
    added: added.map(item),
    fixed: fixed.map(item),
    total: cut === -1 ? listed : notes.length,
    more: cut === -1 || listed < notes.length,
  })
}

/** Every change the build carries, features first, then fixes, newest first: the What's new page. */
export function allBetaNotes(embedded: EmbeddedNotes): BetaNotes {
  return {
    added: embedded.notes.filter((note) => note.type === "feat").map(item),
    fixed: embedded.notes.filter((note) => note.type !== "feat").map(item),
    total: embedded.notes.length,
    more: false,
  }
}

/** The build's commit history on GitHub. */
export const betaHistory = (embedded: EmbeddedNotes) => `${REPOSITORY}/commits/${embedded.sha}`

/** The beta run number of a version such as `0.0.0-beta-21180`, or the version itself. */
export function betaBuild(version: string) {
  return version.match(/^v?0\.0\.0-(?:beta|next)-(\d+(?:\.\d+)?)$/)?.[1] ?? version
}

/**
 * A visual as an image source. An image never runs scripts or loads anything, and does not inherit the page's colour, so
 * `color` sets its currentColor. Reduced motion uses the still copy the build made without the animations.
 */
export function visualSource(visual: NonNullable<BetaNote["visual"]>, input: { color: string; still: boolean }) {
  const svg = input.still ? visual.still : visual.animated

  return `data:image/svg+xml,${encodeURIComponent(svg.replace(/<svg\b[^>]*>/i, (open) => `${open}<style>svg{color:${input.color}}</style>`))}`
}

function item(note: typeof Note.Type): BetaNote {
  const summary = note.summary.trim().replace(/\.$/, "")

  return {
    sha: note.sha,
    type: note.type,
    summary: summary.charAt(0).toUpperCase() + summary.slice(1),
    description: note.description,
    visual: note.visual,
    pr: note.pr === undefined ? undefined : { number: note.pr, url: `${REPOSITORY}/pull/${note.pr}` },
    author: note.author && { name: note.author.name, avatar: note.author.avatar },
  }
}
