import { expect, test } from "bun:test"
import { Option } from "effect"
import {
  allBetaNotes,
  betaBuild,
  betaHistory,
  decodeEmbeddedNotes,
  sliceBetaNotes,
  visualSource,
  type EmbeddedNotes,
} from "./beta-notes"

const sha = (n: number) => n.toString(16).padStart(4, "0").padEnd(40, "a")

const short = (n: number) => sha(n).slice(0, 12)

// A build at commit 30 whose history runs from 30 down to 1, with the note type `notes` gives each commit.
function embedded(input: { notes: (n: number) => "feat" | "fix" | "chore" }): EmbeddedNotes {
  const commits = Array.from({ length: 30 }, (_, i) => 30 - i)

  return {
    sha: sha(30),
    commits: commits.map(short),
    notes: commits.flatMap((n) => {
      const type = input.notes(n)

      return type === "chore" ? [] : [{ type, summary: `change ${n}`, sha: short(n) }]
    }),
  }
}

test("lists the notes after the previous commit, features first, humanized, with pull request links", () => {
  const notes = sliceBetaNotes(
    {
      sha: sha(30),
      commits: [short(30), short(29), short(28), short(27), short(26)],
      notes: [
        {
          type: "fix",
          summary: "disable animated wheel scrolling on linux.",
          pr: 57120,
          sha: short(30),
          author: { name: "Ada Lovelace", login: "ada", avatar: "https://avatars.githubusercontent.com/u/1?s=48" },
          description: "Wheel scrolling on Linux no longer glides.",
        },
        { type: "feat", summary: "merge projects across servers", sha: short(29) },
        { type: "perf", summary: "cache the model list", sha: short(28) },
        { type: "feat", summary: "already seen", sha: short(26) },
      ],
    },
    sha(27),
  )

  expect(Option.getOrThrow(notes)).toEqual({
    added: [{ sha: short(29), type: "feat", summary: "Merge projects across servers" }],
    fixed: [
      {
        sha: short(30),
        type: "fix",
        summary: "Disable animated wheel scrolling on linux",
        description: "Wheel scrolling on Linux no longer glides.",
        pr: { number: 57120, url: "https://github.com/anomalyco/opencode/pull/57120" },
        author: { name: "Ada Lovelace", avatar: "https://avatars.githubusercontent.com/u/1?s=48" },
      },
      { sha: short(28), type: "perf", summary: "Cache the model list" },
    ],
    total: 3,
    more: false,
  })
})

test.each([
  // previous commit, note types, [features, fixes] listed, total, more
  ["found, all listed", sha(20), (n: number) => (n % 3 === 0 ? "feat" : "chore"), [4, 0], 4, false],
  ["found, more than 10", sha(5), (n: number) => (n % 2 ? "fix" : "feat"), [5, 5], 25, true],
  ["found, mostly features", sha(10), (n: number) => (n < 28 ? "feat" : "fix"), [7, 3], 20, true],
  ["missing from the history", sha(99), (n: number) => (n % 2 ? "fix" : "feat"), [5, 5], 10, true],
] as const)("previous commit %s", (_, previous, notes, shown, total, more) => {
  const sliced = Option.getOrThrow(sliceBetaNotes(embedded({ notes }), previous))

  expect([sliced.added.length, sliced.fixed.length]).toEqual([...shown])
  expect(sliced.total).toBe(total)
  expect(sliced.more).toBe(more)
})

test.each([
  ["no previous commit", undefined, () => "feat" as const],
  ["the same build", sha(30), () => "feat" as const],
  ["only chores since the previous commit", sha(25), (n: number) => (n < 25 ? "feat" : "chore")],
] as const)("shows nothing for %s", (_, previous, notes) => {
  expect(Option.isNone(sliceBetaNotes(embedded({ notes }), previous))).toBe(true)
})

test("decodes the embedded notes, and none from a build without them", () => {
  const value = embedded({ notes: () => "fix" })

  expect(Option.getOrThrow(decodeEmbeddedNotes(JSON.stringify(value)))).toEqual(value)
  expect(Option.isNone(decodeEmbeddedNotes(undefined))).toBe(true)
})

test.each([
  ["0.0.0-beta-21180", "21180"],
  ["0.0.0-beta-21180.2", "21180.2"],
  ["0.0.0-next-900", "900"],
  ["1.2.3", "1.2.3"],
])("names build %s", (version, build) => {
  expect(betaBuild(version)).toBe(build)
})

test("sources a visual with the page's colour, and its still copy for reduced motion", () => {
  const visual = {
    animated: '<svg viewBox="0 0 240 72"><rect><animate/></rect></svg>',
    still: '<svg viewBox="0 0 240 72"><rect/></svg>',
  }

  const source = (still: boolean) =>
    decodeURIComponent(visualSource(visual, { color: "rgb(1, 2, 3)", still }).replace("data:image/svg+xml,", ""))

  expect(source(false)).toBe(
    '<svg viewBox="0 0 240 72"><style>svg{color:rgb(1, 2, 3)}</style><rect><animate/></rect></svg>',
  )
  expect(source(true)).toBe('<svg viewBox="0 0 240 72"><style>svg{color:rgb(1, 2, 3)}</style><rect/></svg>')
})

test("lists every change the build carries for the What's new page, and links its history", () => {
  const value = embedded({ notes: (n) => (["feat", "fix", "chore"] as const)[n % 3]! })
  const notes = allBetaNotes(value)

  expect(notes.added.map((note) => note.summary)).toEqual(
    [30, 27, 24, 21, 18, 15, 12, 9, 6, 3].map((n) => `Change ${n}`),
  )
  expect(notes.fixed).toHaveLength(10)
  expect([notes.total, notes.more]).toEqual([20, false])
  expect(betaHistory(value)).toBe(`https://github.com/anomalyco/opencode/commits/${sha(30)}`)
})
