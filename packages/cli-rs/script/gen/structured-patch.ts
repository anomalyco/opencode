// Writes crates/acp/src/permission/structured_patch.json: `[old, new, ranges]` cases with the hunk ranges jsdiff's
// `structuredPatch` reports (the `diff` package packages/cli/src/acp/permission.ts uses), for the port in
// crates/acp/src/permission/unified.rs. A table of shapes, then seeded random texts.
import { createRequire } from "node:module"

const require = createRequire(new URL("../../../cli/package.json", import.meta.url).pathname)
const jsdiff: {
  structuredPatch: (
    oldName: string,
    newName: string,
    old: string,
    next: string,
  ) => { hunks: { oldStart: number; oldLines: number; newStart: number; newLines: number }[] }
} = require("diff")

const numbered = (count: number, change: (n: number) => string | undefined = () => undefined) =>
  Array.from({ length: count }, (_, k) => change(k + 1) ?? `${k + 1}\n`).join("")

const table: [string, string][] = [
  ["", ""],
  ["", "a\n"],
  ["a\n", ""],
  ["a\n", "a\n"],
  ["a", "a\n"],
  ["a\n", "a"],
  ["a\nb", "a\nc"],
  ["a\r\nb\r\n", "a\nb\n"],
  ["a\r\nb\r\n", "a\r\nc\r\n"],
  ["a\rb\n", "a\rc\n"],
  ["\n\n\n", "\n\n"],
  ["a\nb\nc\n", "a\nB\nc\n"],
  ["a\nb\nc\n", "c\nb\na\n"],
  ["a\nb\na\nb\n", "b\na\nb\na\n"],
  ["x\nx\nx\n", "x\nx\n"],
  ["a\nx\nb\n", "a\nb\nx\n"],
  [numbered(20), numbered(20, (n) => (n === 2 ? "two\n" : n === 19 ? "nineteen\n" : undefined))],
  [numbered(30), numbered(30, (n) => (n === 5 || n === 14 ? `${n}!\n` : undefined))],
  [numbered(30), numbered(30, (n) => (n === 5 || n === 13 ? `${n}!\n` : undefined))],
  [numbered(30), numbered(30, (n) => (n === 5 || n === 15 ? `${n}!\n` : undefined))],
  [numbered(12), numbered(12, (n) => (n === 1 || n === 12 ? "" : undefined))],
  [numbered(12), "0\n" + numbered(12) + "13\n"],
  [numbered(9), numbered(9, (n) => (n === 5 ? "" : undefined))],
]

// mulberry32
let seed = 0x5eed
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!
const words = ["a", "b", "c", "d", "", "  x", "long line"]
const text = (lines: string[]) => {
  const ending = random() < 0.15 ? "\r\n" : "\n"
  const joined = lines.join(ending)
  return lines.length > 0 && random() < 0.8 ? joined + ending : joined
}
const randomCases = Array.from({ length: 400 }, (): [string, string] => {
  const old = Array.from({ length: Math.floor(random() * 30) }, () => pick(words))
  // Mostly edits of the old text, so hunks have context; sometimes an unrelated text.
  const next =
    random() < 0.2
      ? Array.from({ length: Math.floor(random() * 30) }, () => pick(words))
      : old.flatMap((line) => {
          const roll = random()
          if (roll < 0.08) return []
          if (roll < 0.16) return [pick(words)]
          if (roll < 0.22) return [line, pick(words)]
          return [line]
        })
  return [text(old), text(next)]
})

const ranges = (old: string, next: string) =>
  jsdiff
    .structuredPatch("a", "a", old, next)
    .hunks.map((hunk) => `${hunk.oldStart},${hunk.oldLines},${hunk.newStart},${hunk.newLines}`)
    .join(" ")
const cases = [...table, ...randomCases].map(([old, next]) => [old, next, ranges(old, next)])

const file = new URL("../../crates/acp/src/permission/structured_patch.json", import.meta.url).pathname
await Bun.write(file, JSON.stringify(cases, null, 0).replaceAll("],[", "],\n[") + "\n")
console.log(`structured-patch: ${cases.length} cases`)
