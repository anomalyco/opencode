import { describe, expect, test } from "bun:test"
import { createTwoFilesPatch, diffLines } from "diff"
import { fileDiff } from "../../src/tool/plugin/file-diff"

// The two-pass diff fileDiff replaced: its patch and counts are what fileDiff must still give.
const reference = (file: string, before: string, after: string) => ({
  file,
  patch: createTwoFilesPatch(file, file, before, after),
  status: "modified" as const,
  additions: diffLines(before, after).reduce((sum, item) => sum + (item.added ? (item.count ?? 0) : 0), 0),
  deletions: diffLines(before, after).reduce((sum, item) => sum + (item.removed ? (item.count ?? 0) : 0), 0),
})

const texts = [
  "",
  "\n",
  "\n\n",
  "a",
  "a\n",
  "a\nb",
  "a\nb\n",
  "a\r\nb\r\n",
  "a\r\nb",
  "\r",
  "a\r",
  " \n+\n-x\n\\ No newline at end of file\n",
  "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
  "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nNINE\nten",
]

// Deterministic texts with shared and changed lines, so hunks split, merge and carry context.
const generated = Array.from({ length: 40 }, (_, seed) => {
  let state = seed + 1
  const next = () => (state = (state * 1103515245 + 12345) % 2147483648)
  const lines = Array.from({ length: next() % 30 }, (_, index) => (next() % 4 === 0 ? `changed ${next() % 5}` : `line ${index}`))
  return lines.join("\n") + (next() % 2 === 0 ? "\n" : "")
})

describe("fileDiff", () => {
  test("gives the same patch and counts as diffing twice", () => {
    const all = [...texts, ...generated]
    for (const before of all)
      for (const after of all) expect(fileDiff("src/a.ts", before, after)).toEqual(reference("src/a.ts", before, after))
  })
})
