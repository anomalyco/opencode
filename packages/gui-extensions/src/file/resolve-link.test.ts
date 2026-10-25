import { describe, expect, test } from "bun:test"
import { checkFileLinkExists, findFileLink, parseFileLink, type FileLinkTarget } from "./resolve-link"

const workspaceFiles = [
  "src/index.ts",
  "packages/app/src/index.ts",
  "packages/app/src/session/timeline/interaction.ts",
  "packages/session-ui/src/index.ts",
  "packages/session-ui/src/components/markdown.tsx",
  "packages/util/src/path.ts",
  "packages/tui/src/util/path.ts",
]

function fuzzyMatches(query: string, target: string) {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0

  for (const ch of t) {
    if (ch === q[qi]) qi += 1
  }

  return qi === q.length
}

const files = {
  search: async (query: string) => workspaceFiles.filter((item) => fuzzyMatches(query, item)),
}

const find = (path: string) => findFileLink({ files, path, signal: new AbortController().signal })

describe("parseFileLink", () => {
  test.each([
    ["packages/app/src/app.tsx", "packages/app/src/app.tsx", undefined],
    ["session/timeline/interaction.ts:74", "session/timeline/interaction.ts", { start: 74, end: 74 }],
    [
      "packages/app/src/workspaces/files/model.tsx:164:11",
      "packages/app/src/workspaces/files/model.tsx",
      { start: 164, end: 164 },
    ],
    ["src/components/markdown.tsx:398-410", "src/components/markdown.tsx", { start: 398, end: 410 }],
    ["src/components/markdown.tsx#L398", "src/components/markdown.tsx", { start: 398, end: 398 }],
    ["src/components/markdown.tsx#L398-L410", "src/components/markdown.tsx", { start: 398, end: 410 }],
    ["file:///C:/repo/a/b.ts?x=1#L3", "C:/repo/a/b.ts", { start: 3, end: 3 }],
    ["what?.md", "what?.md", undefined],
    ["a#b.md#L10", "a#b.md", { start: 10, end: 10 }],
    ["foo.ts:0", "foo.ts", undefined],
    ["./a/../b.ts", "b.ts", undefined],
    ["..", "..", undefined],
    ["C:12", "C:12", undefined],
    ["../timeline/interaction.ts:74", "../timeline/interaction.ts", { start: 74, end: 74 }],
    ["src/C#/a.cs", "src/C#/a.cs", undefined],
    ["foo#bar.ts", "foo#bar.ts", undefined],
    ["foo.ts:12:", "foo.ts", { start: 12, end: 12 }],
    ["foo.ts:99999999999999999999", "foo.ts", undefined],
    ["\\\\server\\share\\x.ts", "//server/share/x.ts", undefined],
    ["file://server/share/x%20y.ts", "//server/share/x y.ts", undefined],
    ["a%2520b.ts", "a%2520b.ts", undefined],
    ["C:/foo/../../x.ts", "C:/x.ts", undefined],
    ["file:///C:/tmp/demo%20file.ts:12", "C:/tmp/demo file.ts", { start: 12, end: 12 }],
  ])("parses %s", (href, expectedPath, expectedSelection) => {
    const parsed = parseFileLink(href)
    expect(parsed.path).toBe(expectedPath)
    expect(parsed.selection).toEqual(expectedSelection)
  })
})

describe("findFileLink", () => {
  test.each<[string, FileLinkTarget | undefined]>([
    ["src/index.ts", { kind: "file", path: "src/index.ts" }],
    ["session/timeline/interaction.ts", { kind: "file", path: "packages/app/src/session/timeline/interaction.ts" }],
    ["../timeline/interaction.ts", { kind: "file", path: "packages/app/src/session/timeline/interaction.ts" }],
    ["markdown.tsx", { kind: "file", path: "packages/session-ui/src/components/markdown.tsx" }],
    ["index.ts", { kind: "picker", query: "index.ts" }],
    ["util/path.ts", { kind: "file", path: "packages/tui/src/util/path.ts" }],
    ["console.log", undefined],
    ["session-ui/markdown.tsx", undefined],
  ])("%s", async (path, expected) => {
    expect(await find(path)).toEqual(expected)
  })
})

describe("checkFileLinkExists", () => {
  test("confirms indexed and absolute files without reading them", async () => {
    const onDisk = new Set(["C:/tmp/out.html"])
    const signal = new AbortController().signal

    const check = (href: string) =>
      checkFileLinkExists({
        files: {
          ...files,
          exists: async (path: string) => {
            if (path.startsWith("//")) throw new Error(`checked a network share: ${path}`)

            return onDisk.has(path)
          },
          resolve: (path: string) => path,
        },
        href,
        signal,
      })

    expect(await check("interaction.ts:74")).toBe(true)
    expect(await check("index.ts")).toBe(true)
    expect(await check("Interaction.ts")).toBe(false)
    expect(await check("C:/tmp/out.html")).toBe(true)
    expect(await check("C:/tmp/missing.html")).toBe(false)
    expect(await check("~/README.md")).toBe(false)
    expect(await check("\\\\host\\share\\x.ts")).toBe(false)
    expect(await check("console.log")).toBe(false)
  })
})
