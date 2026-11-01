import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  applyPathLinkMarkers,
  detectPathLinks,
  matchPathLinkDigit,
  scanPathCandidates,
  type DetectedPathLink,
} from "../src/util/file-links"
import { tmpdir } from "./fixture/fixture"

test("numbers existing paths in source order and inserts markers", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "out"))
  await writeFile(path.join(tmp.path, "out", "report.md"), "# report")
  const text = "Wrote out/report.md and out/report.md:12:3."
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path })

  expect(
    detection.links.map(({ display, line, column, exists, kind }) => ({ display, line, column, exists, kind })),
  ).toEqual([
    { display: "out/report.md", line: undefined, column: undefined, exists: true, kind: "file" },
    { display: "out/report.md:12:3", line: 12, column: 3, exists: true, kind: "file" },
  ])
  expect(applyPathLinkMarkers(text, detection.parts.get("text:0")!.markers)).toBe(
    "Wrote out/report.md [1] and out/report.md:12:3 [2].",
  )
})

test("detects existing directories, including a trailing slash", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "out"))
  const detection = detectPathLinks([{ id: "text:0", text: "Files live in out/ today." }], { base: tmp.path })

  expect(detection.links).toMatchObject([{ path: path.join(tmp.path, "out"), exists: true, kind: "directory" }])
})

test("ignores fenced code, URLs, code spans, links, and missing relative names", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "out"))
  await writeFile(path.join(tmp.path, "out", "report.md"), "")
  const text = [
    "```",
    "out/report.md",
    "```",
    "https://example.com/out/report.md",
    "Run `out/report.md` now.",
    "Read [the docs](https://example.com/out/report.md).",
    "Nothing at report.md or missing.html.",
  ].join("\n")

  expect(detectPathLinks([{ id: "text:0", text }], { base: tmp.path }).links).toEqual([])
})

test("lists explicitly rooted paths even when they are missing", async () => {
  await using tmp = await tmpdir()
  const text = "Missing ./gone.txt and report.md, plus /definitely-missing-opencode/x.txt."
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path })

  expect(detection.links.map((link) => link.display)).toEqual(["./gone.txt", "/definitely-missing-opencode/x.txt"])
  expect(detection.links.every((link) => !link.exists)).toBe(true)
})

test("does not number slash commands or the filesystem root", async () => {
  await using tmp = await tmpdir()
  const text = "Type /paths, then /goal or /api/users. The root / is not a file."
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path })

  expect(detection.links).toEqual([])
})

test("offers missing rooted directories only when their first segment exists", async () => {
  await using tmp = await tmpdir()
  const root = path.parse(tmp.path).root
  const [first] = path.relative(root, tmp.path).split(path.sep)
  const present = detectPathLinks([{ id: "text:0", text: `Missing /${first}/not-created-yet soon.` }], {
    base: tmp.path,
  })
  const absent = detectPathLinks(
    [{ id: "text:0", text: "Missing /definitely-missing-opencode/not-created-yet." }],
    { base: tmp.path },
  )

  expect(present.links).toMatchObject([{ exists: false }])
  expect(absent.links).toEqual([])
})

test("normalizes dot segments against the session directory", async () => {
  await using tmp = await tmpdir()
  const detection = detectPathLinks([{ id: "text:0", text: "See ../shared/a.ts and /var/log/../tmp/b.ts." }], {
    base: tmp.path,
  })

  expect(detection.links.map((link) => link.path)).toEqual([
    path.resolve(tmp.path, "../shared/a.ts"),
    path.normalize("/var/tmp/b.ts"),
  ])
})

test("keeps the line suffix with the path when scanning", () => {
  const candidates = scanPathCandidates("See out/report.md:12:3 and a.ts.")
  expect(candidates.map((candidate) => candidate.text)).toEqual(["out/report.md:12:3", "a.ts"])
})

test("reuses one number for repeated occurrences", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "a.ts"), "")
  const text = "a.ts then a.ts again"
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path })

  expect(detection.links).toHaveLength(1)
  expect(detection.parts.get("text:0")!.markers).toHaveLength(2)
  expect(applyPathLinkMarkers(text, detection.parts.get("text:0")!.markers)).toBe("a.ts [1] then a.ts [1] again")
})

test("numbers paths across message parts", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "a.ts"), "")
  await writeFile(path.join(tmp.path, "b.ts"), "")
  const detection = detectPathLinks(
    [
      { id: "text:0", text: "a.ts" },
      { id: "text:1", text: "b.ts" },
    ],
    { base: tmp.path },
  )

  expect(detection.links.map((link) => [link.partID, link.display])).toEqual([
    ["text:0", "a.ts"],
    ["text:1", "b.ts"],
  ])
})

test("keeps multi-digit selection unambiguous", () => {
  const links = Array.from({ length: 12 }, (_, index): DetectedPathLink => {
    const number = index + 1
    return { index: number, partID: "text:0", display: `f${number}.ts`, path: `f${number}.ts`, exists: true }
  })

  const first = matchPathLinkDigit(links, "", "1")
  expect(first).toMatchObject({ digits: "1", invalid: false })
  expect(first.matches.map((link) => link.index)).toEqual([1, 10, 11, 12])
  expect(first.exact?.index).toBe(1)

  const second = matchPathLinkDigit(links, "1", "2")
  expect(second).toMatchObject({ digits: "12", invalid: false, exact: { index: 12 } })
  expect(second.matches).toHaveLength(1)

  expect(matchPathLinkDigit(links, "", "0")).toMatchObject({ digits: "", invalid: true, attempted: "0" })
  expect(matchPathLinkDigit(Array.from(links).slice(0, 8), "", "1")).toMatchObject({
    digits: "1",
    invalid: false,
    exact: { index: 1 },
  })
})

test("leaves source untouched when a marker is out of range", () => {
  expect(applyPathLinkMarkers("a.ts", [{ at: 99, index: 1 }])).toBe("a.ts")
})

test("formats markers through the provided formatter", () => {
  expect(applyPathLinkMarkers("a.ts", [{ at: 4, index: 1 }], (index) => `[[${index}]]`)).toBe("a.ts [[1]]")
})

test("keeps a marker next to parentheses from becoming a Markdown link", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "a.ts"), "")
  const text = "resolved in a.ts(see below)"
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path })

  expect(applyPathLinkMarkers(text, detection.parts.get("text:0")!.markers)).toBe("resolved in a.ts [1] (see below)")
})

test("adds a readable space between each path and its number", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "a.ts"), "")
  await writeFile(path.join(tmp.path, "b.ts"), "")
  const text = "a.ts then b.ts then a.ts"
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path })

  expect(applyPathLinkMarkers(text, detection.parts.get("text:0")!.markers)).toBe(
    "a.ts [1] then b.ts [2] then a.ts [1]",
  )
})
