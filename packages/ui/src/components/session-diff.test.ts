import { describe, expect, test } from "bun:test"
import { formatPatch, structuredPatch } from "diff"
import { normalize, resolveFileDiff, text } from "./session-diff"

describe("session diff", () => {
  test("keeps unified patch content", () => {
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
    expect(view.fileDiff.isPartial).toBe(true)
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

  test("renders full-context generated patches as concise complete diffs", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
    const after = before.replace("line 15", "changed line 15")
    const view = normalize({
      file: "big.txt",
      patch: formatPatch(
        structuredPatch("big.txt", "big.txt", before, after, "", "", { context: Number.MAX_SAFE_INTEGER }),
      ),
      additions: 1,
      deletions: 1,
      status: "modified" as const,
    })

    expect(view.fileDiff.isPartial).toBe(false)
    expect(view.fileDiff.hunks).toHaveLength(1)
    expect(view.fileDiff.hunks[0]?.collapsedBefore).toBeGreaterThan(0)
    expect(view.fileDiff.hunks[0]?.splitLineCount).toBeLessThan(30)
    expect(text(view, "deletions")).toBe(before)
    expect(text(view, "additions")).toBe(after)
  })

  test("renders generated patches with edge changes as concise complete diffs", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
    const after = before.replace("line 4", "changed line 4").replace("line 27", "changed line 27")
    const view = normalize({
      file: "big.txt",
      patch: formatPatch(
        structuredPatch("big.txt", "big.txt", before, after, "", "", { context: Number.MAX_SAFE_INTEGER }),
      ),
      additions: 2,
      deletions: 2,
      status: "modified" as const,
    })

    expect(view.fileDiff.isPartial).toBe(false)
    expect(view.fileDiff.hunks).toHaveLength(2)
    expect(view.fileDiff.hunks[0]?.splitLineCount).toBeLessThan(30)
    expect(text(view, "deletions")).toBe(before)
    expect(text(view, "additions")).toBe(after)
  })

  test("keeps top-of-file patches with standard context partial", () => {
    const fileDiff = resolveFileDiff({
      file: "a.ts",
      patch:
        "Index: a.ts\n===================================================================\n--- a.ts\t\n+++ a.ts\t\n@@ -1,4 +1,4 @@\n-old\n+new\n line 2\n line 3\n line 4\n",
    })
    const view = { file: "a.ts", additions: 1, deletions: 1, fileDiff }

    expect(fileDiff.isPartial).toBe(true)
    expect(text(view, "deletions")).toBe("old\nline 2\nline 3\nline 4\n")
    expect(text(view, "additions")).toBe("new\nline 2\nline 3\nline 4\n")
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

  test("keeps full legacy content as a complete diff", () => {
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
})
