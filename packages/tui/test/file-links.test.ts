import { expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  applyPathLinkMarkers,
  detectPathLinks,
  matchPathLinkDigit,
  pathLinkSelectionTag,
  pathLinkTag,
  scanPathCandidates,
  togglePathLinkSelection,
  type DetectedPathLink,
} from "../src/util/file-links"
import { tmpdir } from "./fixture/fixture"

test("numbers existing paths in source order and inserts markers outside syntax", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "out"))
  await writeFile(path.join(tmp.path, "out", "report.md"), "# report")
  const text = "Wrote `out/report.md` and out/report.md:12:3."
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path })

  expect(
    detection.links.map(({ display, line, column, exists, kind }) => ({ display, line, column, exists, kind })),
  ).toEqual([
    { display: "out/report.md", line: undefined, column: undefined, exists: true, kind: "file" },
    { display: "out/report.md:12:3", line: 12, column: 3, exists: true, kind: "file" },
  ])
  expect(applyPathLinkMarkers(text, detection.parts.get("text:0")!.markers)).toBe(
    "Wrote `out/report.md` [1] and out/report.md:12:3 [2].",
  )
})

test("detects existing directories, including a trailing slash", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "out"))
  const detection = detectPathLinks([{ id: "text:0", text: "Files live in out/ today." }], {
    base: tmp.path,
    home: tmp.path,
  })

  expect(detection.links).toMatchObject([{ path: path.join(tmp.path, "out"), exists: true, kind: "directory" }])
})

test("keeps quoted paths with spaces together", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "docs note.md"), "")
  const text = 'Open "docs note.md" next.'
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path })

  expect(detection.links).toMatchObject([{ display: "docs note.md", exists: true }])
  expect(applyPathLinkMarkers(text, detection.parts.get("text:0")!.markers)).toBe('Open "docs note.md" [1] next.')
})

test("detects local Markdown links and their target line", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "a.ts"), "")
  const text = "See [a.ts](a.ts#L4)."
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path })

  expect(detection.links).toMatchObject([{ display: "a.ts#L4", path: path.join(tmp.path, "a.ts"), line: 4 }])
  expect(applyPathLinkMarkers(text, detection.parts.get("text:0")!.markers)).toBe("See [a.ts](a.ts#L4) [1].")
})

test("resolves file URLs and keeps their line and column", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "a b.ts")
  await writeFile(file, "")
  const text = `Open <${pathToFileURL(file).href}#L4C2>.`
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path })

  expect(detection.links).toMatchObject([{ path: file, line: 4, column: 2, exists: true }])
})

test("expands a home directory path", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "notes.txt"), "")
  const detection = detectPathLinks([{ id: "text:0", text: "See ~/notes.txt." }], {
    base: path.join(tmp.path, "elsewhere"),
    home: tmp.path,
  })

  expect(detection.links).toMatchObject([{ path: path.join(tmp.path, "notes.txt"), exists: true }])
})

test("ignores fenced code, URLs, commands, and missing relative names", async () => {
  await using tmp = await tmpdir()
  await mkdir(path.join(tmp.path, "out"))
  await writeFile(path.join(tmp.path, "out", "report.md"), "")
  const text = [
    "```",
    "out/report.md",
    "```",
    "https://example.com/out/report.md",
    "Run `npm install` now.",
    "Read [the docs](https://example.com/out/report.md).",
    "Nothing at report.md or missing.html.",
  ].join("\n")

  expect(detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path }).links).toEqual([])
})

test("lists explicitly rooted paths even when they are missing", async () => {
  await using tmp = await tmpdir()
  const text = "Missing ./gone.txt and report.md, plus /definitely-missing-opencode/x.txt."
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path })

  expect(detection.links.map((link) => link.display)).toEqual(["./gone.txt", "/definitely-missing-opencode/x.txt"])
  expect(detection.links.every((link) => !link.exists)).toBe(true)
})

test("parses Windows drive paths, columns, and UNC shares without touching the filesystem", () => {
  const candidates = scanPathCandidates("Copy D:/repo/a.ts:7:2 and \\\\server\\share\\b.ts now.")
  expect(candidates.map((candidate) => candidate.text)).toEqual(["D:/repo/a.ts:7:2", "\\\\server\\share\\b.ts"])

  const detection = detectPathLinks([{ id: "text:0", text: "See C:\\nope\\x.ts:9:3." }], {
    base: "C:\\repo",
    home: "C:\\Users\\me",
    platform: "win32",
  })
  expect(detection.links).toMatchObject([{ path: "C:\\nope\\x.ts", line: 9, column: 3, exists: false }])
})

test("resolves Windows file URLs and UNC shares", () => {
  const url = new URL("file:///C:/Users/me/report%201.txt#L3C2")
  const detection = detectPathLinks([{ id: "text:0", text: `Open <${url.href}>.` }], {
    base: "C:\\repo",
    home: "C:\\Users\\me",
    platform: "win32",
  })
  expect(detection.links).toMatchObject([{ path: "C:\\Users\\me\\report 1.txt", line: 3, column: 2, exists: false }])

  const unc = detectPathLinks([{ id: "text:0", text: "See <file://127.0.0.1/share/x.ts>." }], {
    base: "C:\\repo",
    home: "C:\\Users\\me",
    platform: "win32",
  })
  expect(unc.links).toMatchObject([{ path: "\\\\127.0.0.1\\share\\x.ts", exists: false }])
})

test("expands a Windows home path with either separator", () => {
  for (const raw of ["~\\notes.txt", "~/notes.txt"]) {
    const detection = detectPathLinks([{ id: "text:0", text: `See ${raw}.` }], {
      base: "C:\\repo",
      home: "C:\\Users\\me",
      platform: "win32",
    })
    expect(detection.links).toMatchObject([{ path: "C:\\Users\\me\\notes.txt", exists: false }])
  }
})

test("ignores remote and malformed file URLs on POSIX", () => {
  const detection = detectPathLinks(
    [{ id: "text:0", text: "See <file://server/share/x.ts> and <file:///definitely-missing/gone.ts>." }],
    { base: "/repo", home: "/home/me", platform: "linux" },
  )

  expect(detection.links).toMatchObject([{ path: "/definitely-missing/gone.ts", exists: false }])
})

test("normalizes POSIX paths against the session directory", () => {
  for (const platform of ["linux", "darwin"] as const) {
    const detection = detectPathLinks([{ id: "text:0", text: "See ../shared/a.ts and /var/log/../tmp/b.ts." }], {
      base: "/repo/work",
      home: "/home/me",
      platform,
    })
    expect(detection.links.map((link) => link.path)).toEqual(["/repo/shared/a.ts", "/var/tmp/b.ts"])
  }
})

test("reuses one number for repeated occurrences", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "a.ts"), "")
  const text = "a.ts then a.ts again"
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path })

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
    { base: tmp.path, home: tmp.path },
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

test("keeps a marker next to parentheses from becoming a Markdown link", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "a.ts"), "")
  const text = "resolved in a.ts(see below)"
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path })

  expect(applyPathLinkMarkers(text, detection.parts.get("text:0")!.markers)).toBe("resolved in a.ts [1] (see below)")
})

test("adds a readable space between each path and its tag", async () => {
  await using tmp = await tmpdir()
  await writeFile(path.join(tmp.path, "a.ts"), "")
  await writeFile(path.join(tmp.path, "b.ts"), "")
  const text = "a.ts then b.ts then a.ts"
  const detection = detectPathLinks([{ id: "text:0", text }], { base: tmp.path, home: tmp.path })
  const markers = detection.parts.get("text:0")!.markers

  expect(applyPathLinkMarkers(text, markers, pathLinkTag)).toBe("a.ts ~~1~~ then b.ts ~~2~~ then a.ts ~~1~~")
  expect(applyPathLinkMarkers(text, markers, (index) => pathLinkSelectionTag(index, index === 2))).toBe(
    "a.ts ~~○1~~ then b.ts ~~●2~~ then a.ts ~~○1~~",
  )
})

test("toggles multi-selection without exceeding the limit", () => {
  const empty = new Set<number>()
  const first = togglePathLinkSelection(empty, 2, 2)
  expect(first).toEqual({ selected: new Set([2]), capped: false })
  expect(empty.size).toBe(0)

  const second = togglePathLinkSelection(first.selected, 5, 2)
  expect(second).toEqual({ selected: new Set([2, 5]), capped: false })

  const capped = togglePathLinkSelection(second.selected, 7, 2)
  expect(capped).toEqual({ selected: second.selected, capped: true })

  const removed = togglePathLinkSelection(second.selected, 2, 2)
  expect(removed).toEqual({ selected: new Set([5]), capped: false })
})
