import { describe, expect, test } from "bun:test"
import { expandReviewFolders, reviewDiffDirectory, reviewDiffNeedsLoad, sortReviewPaths } from "./kinds"

describe("reviewDiffNeedsLoad", () => {
  test("loads changed files whose aggregate patch has no hunks", () => {
    expect(
      reviewDiffNeedsLoad({
        file: "src/a.ts",
        additions: 1,
        deletions: 0,
        status: "modified",
        patch: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts",
      }),
    ).toBe(true)
  })

  test("keeps complete patches and empty changes", () => {
    expect(
      reviewDiffNeedsLoad({
        file: "src/a.ts",
        additions: 1,
        deletions: 0,
        status: "modified",
        patch: "@@ -0,0 +1 @@\n+value",
      }),
    ).toBe(false)
    expect(reviewDiffNeedsLoad({ file: "empty.txt", patch: "", additions: 0, deletions: 0, status: "modified" })).toBe(
      false,
    )
  })
})

describe("reviewDiffDirectory", () => {
  test("scopes nested files to their parent directory", () => {
    expect(reviewDiffDirectory("/repo", "src/lib/a.ts")).toBe("/repo/src/lib")
    expect(reviewDiffDirectory("C:\\repo", "src/lib/a.ts")).toBe("C:\\repo\\src\\lib")
  })

  test("does not rescope root files", () => {
    expect(reviewDiffDirectory("/repo/", "README.md")).toBe("/repo")
    expect(reviewDiffDirectory("/", "README.md")).toBe("/")
    expect(reviewDiffDirectory("C:\\", "README.md")).toBe("C:\\")
    expect(reviewDiffDirectory("/", "src/a.ts")).toBe("/src")
    expect(reviewDiffDirectory("C:\\", "src/a.ts")).toBe("C:\\src")
  })
})

describe("sortReviewPaths", () => {
  test("orders navigation depth-first with directories before sibling files", () => {
    const paths = ["README.md", "src/a.ts", "src/lib/z.ts", "docs/guide.md", "src/lib/b.ts"]

    expect(sortReviewPaths(paths)).toEqual(["docs/guide.md", "src/lib/b.ts", "src/lib/z.ts", "src/a.ts", "README.md"])
    expect(paths[0]).toBe("README.md")
  })

  test("preserves original paths for selection", () => {
    expect(sortReviewPaths(["README.md", "src\\lib\\a.ts", "/docs//guide.md/"])).toEqual([
      "/docs//guide.md/",
      "src\\lib\\a.ts",
      "README.md",
    ])
  })
})

describe("expandReviewFolders", () => {
  test("lists an opened untracked folder's entries after its row, without changing the top-level rows", () => {
    const row = (file: string) => ({ file, patch: "", additions: 0, deletions: 0, status: "added" as const })
    const rows = [row("keep.txt"), row("research/")]
    const inside = [...Array.from({ length: 50 }, (_, index) => row(`research/${index}.md`)), row("research/deep/")]

    expect(expandReviewFolders(rows, new Map()).map((diff) => diff.file)).toEqual(["keep.txt", "research/"])

    const expanded = expandReviewFolders(
      rows,
      new Map([
        ["research/", inside],
        ["research/deep/", [row("research/deep/inner.md")]],
      ]),
    ).map((diff) => diff.file)

    expect(expanded).toHaveLength(54)
    expect(expanded.slice(0, 3)).toEqual(["keep.txt", "research/", "research/0.md"])
    expect(expanded.slice(-2)).toEqual(["research/deep/", "research/deep/inner.md"])

    // A listing that stopped early ends with a `more` entry for the folder itself, which stays out of the rows.
    const stopped = expandReviewFolders(
      rows,
      new Map([["research/", [row("research/a.md"), { ...row("research/"), more: true as const }]]]),
    )

    expect(stopped.map((diff) => diff.file)).toEqual(["keep.txt", "research/", "research/a.md"])
  })
})
