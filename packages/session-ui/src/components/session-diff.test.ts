import { describe, expect, test } from "bun:test"
import { parseDiffFromFile } from "@pierre/diffs"
import { createTwoFilesPatch } from "diff"
import { completePatchContents, normalize, resolveFileDiff, text } from "./session-diff"

const header = "diff --git a/a.ts b/a.ts\nindex 1a2b3c4..5d6e7f8 100644\n--- a/a.ts\n+++ b/a.ts\n"

describe("session diff", () => {
  test.each([
    ["carriage return", "\r"],
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
  ])(
    "parses adversarial patch headers containing a %s",
    (_, separator) => {
      // GHSA-73rr-hh4g-fpgx: isolate synchronous hangs and memory growth from the test runner.
      const name = `a${separator}b.ts`
      const padding = " ".repeat(10_000)

      const patches = [
        `--- ${name}\t\n+++ b.ts\t\n`,
        `--- a.ts\t\n+++ ${name}\t\n`,
        `--- ${padding}${name}\t\n+++ b.ts\t\n`,
        `--- a.ts\t\n+++ ${padding}${name}\t\n`,
        `Index: ${padding}${name}\n--- a.ts\t\n+++ b.ts\t\n`,
        `diff -r abc -r def ${padding}${name}\n--- a.ts\t\n+++ b.ts\t\n`,
      ].map((header) => `${header}@@ -1 +1 @@\n-old\n+new\n`)

      const result = Bun.spawnSync({
        cmd: [
          process.execPath,
          "--eval",
          `import { completePatchContents } from "./session-diff.ts"
         console.log(JSON.stringify((await Bun.stdin.json()).map(completePatchContents)))`,
        ],
        cwd: import.meta.dir,
        stdin: Buffer.from(JSON.stringify(patches)),
        timeout: 5_000,
        killSignal: "SIGKILL",
      })

      expect(result.exitCode, result.stderr.toString()).toBe(0)
      expect(JSON.parse(result.stdout.toString())).toEqual(patches.map(() => ({ before: "old\n", after: "new\n" })))
    },
    10_000,
  )

  test("renders whole-file unified patches as complete diffs", () => {
    const diff = {
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }

    const view = normalize(diff)

    expect(view.fileDiff.name).toBe("a.ts")
    expect(view.fileDiff.isPartial).toBe(false)
    expect(text(view, "deletions")).toBe("one\ntwo\n")
    expect(text(view, "additions")).toBe("one\nthree\n")
  })

  test("keeps missing final newlines from unified patches", () => {
    const diff = {
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+three\n\\ No newline at end of file\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }

    const view = normalize(diff)

    expect(text(view, "deletions")).toBe("one\ntwo")
    expect(text(view, "additions")).toBe("one\nthree")
  })

  test("renders whole-file VCS patches as complete diffs", () => {
    const fileDiff = resolveFileDiff({
      file: "a.ts",
      patch:
        "diff --git a/a.ts b/a.ts\nindex 1a2b3c4..5d6e7f8 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,2 @@\n one\n-old\n+new\n",
    })

    expect(fileDiff.isPartial).toBe(false)
    expect(fileDiff.additionLines).toEqual(["one\n", "new\n"])
  })

  test("keeps the producer's line alignment for complete patches", () => {
    // Valid but not minimal: diffing the rebuilt files again would keep `b` as unchanged context.
    const patch = `${header}@@ -1,3 +1,3 @@\n a\n-b\n-c\n+b\n+d\n`
    const fileDiff = resolveFileDiff({ file: "a.ts", patch })

    expect(fileDiff.isPartial).toBe(false)
    expect(fileDiff.hunks.map((hunk) => [hunk.deletionLines, hunk.additionLines])).toEqual([[2, 2]])
    // A content diff of the same files has different hunks, so it must not share the highlight identity.
    expect(resolveFileDiff({ file: "a.ts", before: "a\nb\nc\n", after: "a\nb\nd\n" }).cacheKey).not.toBe(
      fileDiff.cacheKey,
    )
  })

  test.each([
    [
      "missing final newlines",
      "@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+three\n\\ No newline at end of file\n",
    ],
    ["an added final newline", "@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+two\n"],
    ["CRLF lines", "@@ -1,3 +1,3 @@\n one\r\n-two\r\n+three\r\n four\r\n"],
    ["a new file", "@@ -0,0 +1,3 @@\n+one\n+two\n+three\n"],
    ["a deleted file", "@@ -1,3 +0,0 @@\n-one\n-two\n-three\n"],
    ["a leading marker", "@@ -1,1 +1,1 @@\n\\ No newline at end of file\n-old\n+new\n"],
    ["interleaved changes", "@@ -1,4 +1,4 @@\n keep\n-a\n+b\n-c\n+d\n keep\n"],
  ])("splits complete patches with %s like a fresh file diff", (_, hunk) => {
    const patch = `${header}${hunk}`
    const contents = completePatchContents(patch)!

    const expected = parseDiffFromFile(
      { name: "a.ts", contents: contents.before },
      { name: "a.ts", contents: contents.after },
    )

    expect({ ...resolveFileDiff({ file: "a.ts", patch }), cacheKey: undefined }).toEqual({
      ...expected,
      cacheKey: undefined,
    })
  })

  test.each(["a\tb.ts", "a\nb.ts", '"quoted"', " padded.ts "])(
    "keeps the exact file name %j for complete patches",
    (file) => {
      expect(resolveFileDiff({ file, patch: `${header}@@ -1,2 +1,2 @@\n one\n-old\n+new\n` }).name).toBe(file)
      expect(resolveFileDiff({ file, patch: `${header}@@ -0,0 +0,0 @@\n` }).name).toBe(file)
    },
  )

  test("collapses unchanged runs in complete patches into the hunks of a fresh file diff", () => {
    const before = Array.from({ length: 40 }, (_, index) => `line ${index}\n`)
    const after = before.map((line, index) => (index === 3 || index === 30 ? `changed ${index}\n` : line))
    const body = before.map((line, index) => (line === after[index] ? ` ${line}` : `-${line}+${after[index]}`)).join("")

    const fileDiff = resolveFileDiff({
      file: "a.ts",
      patch: `${header}@@ -1,40 +1,40 @@\n${body}`,
    })

    expect(fileDiff.hunks).toHaveLength(2)
    expect(fileDiff.hunks).toEqual(
      parseDiffFromFile({ name: "a.ts", contents: before.join("") }, { name: "a.ts", contents: after.join("") }).hunks,
    )
  })

  test("keeps ordinary leading tool patches partial", () => {
    const fileDiff = resolveFileDiff({
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\n+++ a.ts\n@@ -1,5 +1,5 @@\n-old\n+new\n two\n three\n four\n five\n",
    })

    expect(fileDiff.isPartial).toBe(true)
    expect(fileDiff.additionLines).toEqual(["new\n", "two\n", "three\n", "four\n", "five\n"])
  })

  test("keeps separated patch hunks partial without complete file contents", () => {
    const fileDiff = resolveFileDiff({
      file: "project.ts",
      patch:
        'Index: project.ts\n===================================================================\n--- project.ts\t\n+++ project.ts\t\n@@ -1,3 +1,2 @@\n import { and } from "drizzle-orm"\n-import { sql } from "drizzle-orm"\n import { ProjectTable } from "./project.sql"\n@@ -346,3 +345,3 @@\n import { Database } from "@/storage/db"\n-import { ProjectTable } from "./project.sql"\n+import { ProjectTable } from "../project/project.sql"\n import { SessionTable } from "../session/session.sql"\n',
    })

    expect(fileDiff.isPartial).toBe(true)
    expect(fileDiff.hunks).toHaveLength(2)
    expect(fileDiff.hunks[1]?.collapsedBefore).toBeGreaterThan(0)
  })

  test("renders headerless persisted patches", () => {
    const view = normalize({
      file: "a.ts",
      patch: "@@ -1 +1 @@\n-old\n+new\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    })

    expect(view.fileDiff.name).toBe("a.ts")
    expect(view.fileDiff.isPartial).toBe(true)
    expect(text(view, "deletions")).toBe("old\n")
    expect(text(view, "additions")).toBe("new\n")
  })

  test("does not share headerless patch metadata between files", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new\n"

    expect(resolveFileDiff({ file: "a.ts", patch }).name).toBe("a.ts")
    expect(resolveFileDiff({ file: "b.ts", patch }).name).toBe("b.ts")
  })

  test.each(["@@ -1 +1 @@\n-old\n+new\n", "--- a.ts\t\n+++ a.ts\t\n@@ -1 +1 @@\n-old\n+new\n"])(
    "reuses a highlight identity for the same cached patch: %s",
    (patch) => {
      const first = resolveFileDiff({ file: "a.ts", patch })
      expect(first.cacheKey).toBeString()
      expect(resolveFileDiff({ file: "a.ts", patch }).cacheKey).toBe(first.cacheKey)
      expect(resolveFileDiff({ file: "b.ts", patch }).cacheKey).not.toBe(first.cacheKey)
      expect(resolveFileDiff({ file: "a.ts", patch: patch.replace("+new", "+next") }).cacheKey).not.toBe(first.cacheKey)
    },
  )

  test("keys preloaded content diffs by file name and content", () => {
    const diff = { file: "a.ts", before: "one\n", after: "two\n", additions: 1, deletions: 1 }
    const first = normalize(diff).fileDiff
    expect(first.cacheKey).toBeString()
    expect(normalize(diff).fileDiff.cacheKey).toBe(first.cacheKey)
    expect(normalize({ ...diff, file: "a.py" }).fileDiff.cacheKey).not.toBe(first.cacheKey)
    expect(normalize({ ...diff, after: "three\n" }).fileDiff.cacheKey).not.toBe(first.cacheKey)
  })

  test("reuses the parsed content diff until its inputs change", () => {
    const diff = { file: "cached.ts", before: "one\n", after: "two\n", additions: 1, deletions: 1 }
    const first = normalize(diff).fileDiff

    expect(normalize({ ...diff }).fileDiff).toBe(first)

    const changed = normalize({ ...diff, after: "three\n" }).fileDiff
    expect(changed).not.toBe(first)
    expect(changed.additionLines).toEqual(["three\n"])
    expect(normalize({ ...diff, file: "cached.py" }).fileDiff).not.toBe(first)
  })

  test("evicts the oldest parsed content diff once the cache is full", () => {
    const diff = { file: "evicted-content.ts", before: "one\n", after: "two\n", additions: 1, deletions: 1 }
    const first = normalize(diff).fileDiff

    Array.from({ length: 20 }, (_, index) => normalize({ ...diff, after: `two${index}\n` }))

    const restored = normalize(diff).fileDiff
    expect(restored).not.toBe(first)
    expect(restored.additionLines).toEqual(first.additionLines)
    expect(restored.cacheKey).toBe(first.cacheKey)
  })

  test("does not reuse an evicted highlight identity for different content", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new\n"
    const first = resolveFileDiff({ file: "evicted.ts", patch })

    const keys = Array.from(
      { length: 20 },
      (_, index) => resolveFileDiff({ file: "evicted.ts", patch: patch.replace("+new", `+new${index}`) }).cacheKey,
    )

    expect(keys).not.toContain(first.cacheKey)
    const restored = resolveFileDiff({ file: "evicted.ts", patch })
    expect(restored.additionLines).toEqual(first.additionLines)
    expect(restored.cacheKey).toBeString()
  })

  test("keeps capped header-only patches partial", () => {
    const fileDiff = resolveFileDiff({
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n",
    })

    expect(fileDiff.name).toBe("a.ts")
    expect(fileDiff.isPartial).toBe(true)
    expect(fileDiff.hunks).toEqual([])
  })

  test("keeps full preloaded content as a complete diff", () => {
    const diff = {
      file: "a.ts",
      before: "one\n",
      after: "two\n",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }

    const view = normalize(diff)

    expect(view.fileDiff.isPartial).toBe(false)
    expect(text(view, "deletions")).toBe("one\n")
    expect(text(view, "additions")).toBe("two\n")
  })

  test("ignores malformed persisted patches", () => {
    const diff = {
      file: "a.ts",
      patch:
        "diff --git a/a.ts b/a.ts\nindex ff4ceb2..65a1de0 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n keep\n+add\n same\r",
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    }

    const view = normalize(diff)

    expect(text(view, "deletions")).toBe("")
    expect(text(view, "additions")).toBe("")
  })

  describe("real patches", () => {
    const before = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index}\n`).join("")
    const after = before.replace("const line3 = 3\n", "const line3 = 33\n").replace("const line25 = 25\n", "")
    const sum = 'import { a } from "./a"\n\nexport function sum(x: number, y: number) {\n  return x + y\n}\n'

    const git = (header: string) =>
      `diff --git ${header}\nindex da208dc..e8d3c2d 100644\n--- ${header.split(" ")[0]}\n+++ ${header.split(" ")[1]}\n@@ -1,5 +1,5 @@\n import { a } from "./a"\n \n-export function sum(x: number, y: number) {\n-  return x + y\n+export function sum(x: number, y: number, z = 0) {\n+  return x + y + z\n }\n`

    test("reads an edit tool patch as partial hunks", () => {
      // The edit and write tools call createTwoFilesPatch with jsdiff's default context and no headers.
      const fileDiff = resolveFileDiff({
        file: "src/lines.ts",
        patch: createTwoFilesPatch("src/lines.ts", "src/lines.ts", before, after),
      })

      expect(fileDiff.name).toBe("src/lines.ts")
      expect(fileDiff.isPartial).toBe(true)
      expect(
        fileDiff.hunks.map((hunk) => [hunk.deletionStart, hunk.deletionCount, hunk.additionStart, hunk.additionCount]),
      ).toEqual([
        [1, 8, 1, 8],
        [22, 9, 22, 8],
      ])
      expect(fileDiff.deletionLines).toContain("const line3 = 3\n")
      expect(fileDiff.additionLines).toContain("const line3 = 33\n")
      expect(fileDiff.additionLines).not.toContain("const line25 = 25\n")
    })

    test.each([
      ["an edit", before, after],
      ["a new file", "", "one\ntwo\n"],
      ["a deleted file", "one\ntwo\n", ""],
      ["CRLF lines without a final newline", "one\r\ntwo\r\nthree", "one\r\n2\r\nthree"],
      ["an added final newline", "one\ntwo", "one\ntwo\n"],
    ])("renders a full-context snapshot patch of %s like a fresh file diff", (_, before, after) => {
      const patch = createTwoFilesPatch("a.ts", "a.ts", before, after, "", "", { context: 2_147_483_647 })

      expect(completePatchContents(patch)).toEqual({ before, after })
      expect({ ...resolveFileDiff({ file: "a.ts", patch }), cacheKey: undefined }).toEqual({
        ...parseDiffFromFile({ name: "a.ts", contents: before }, { name: "a.ts", contents: after }),
        cacheKey: undefined,
      })
    })

    test.each(["a/sum.ts b/sum.ts", "sum.ts sum.ts", "i/sum.ts w/sum.ts"])(
      "renders a full-context git patch with header %j as a complete diff",
      (header) => {
        // Git's diff.noprefix and diff.mnemonicPrefix settings change the header, not the hunks.
        expect(completePatchContents(git(header))).toEqual({
          before: sum,
          after: sum.replace("y: number)", "y: number, z = 0)").replace("x + y\n", "x + y + z\n"),
        })
        expect(resolveFileDiff({ file: "sum.ts", patch: git(header) }).isPartial).toBe(false)
      },
    )

    test("keeps a missing final newline from a real CRLF git patch", () => {
      const patch =
        "diff --git a/crlf.txt b/crlf.txt\nindex bc16163..88fdbd5 100644\n--- a/crlf.txt\n+++ b/crlf.txt\n@@ -1,3 +1,3 @@\n one\r\n-two\r\n+2\r\n three\n\\ No newline at end of file\n"

      expect(completePatchContents(patch)).toEqual({ before: "one\r\ntwo\r\nthree", after: "one\r\n2\r\nthree" })
    })

    test("ignores an edit tool patch whose hunk lost a line", () => {
      const patch = createTwoFilesPatch("a.ts", "a.ts", before, after).replace(" const line1 = 1\n", "")

      expect(resolveFileDiff({ file: "a.ts", patch }).hunks).toEqual([])
      expect(completePatchContents(patch)).toBeUndefined()
    })
  })
})
