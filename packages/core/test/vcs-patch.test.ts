import { describe, expect, test } from "bun:test"
import { VcsPatch } from "@opencode/core/vcs/patch"

describe("VcsPatch countPatch", () => {
  test("counts a plain change", () => {
    const patch = ["--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-old", "+new"].join("\n")
    expect(VcsPatch.countPatch(patch)).toEqual({ additions: 1, deletions: 1 })
  })

  test("counts changed lines whose content starts with ++ or --", () => {
    const patch = [
      "--- a/query.sql",
      "+++ b/query.sql",
      "@@ -1,2 +1,2 @@",
      "--- removed comment",
      "+++ added comment",
      " select 1;",
    ].join("\n")
    expect(VcsPatch.countPatch(patch)).toEqual({ additions: 1, deletions: 1 })
  })

  test("ignores the file headers of every file in a patch", () => {
    const patch = [
      "diff --git a/a.txt b/a.txt",
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/b.txt b/b.txt",
      "--- a/b.txt",
      "+++ b/b.txt",
      "@@ -1 +1 @@",
      "-gone",
      "+kept",
    ].join("\n")
    expect(VcsPatch.countPatch(patch)).toEqual({ additions: 2, deletions: 2 })
  })

  test("counts a file added from nothing", () => {
    const patch = ["--- /dev/null", "+++ b/new.txt", "@@ -0,0 +1,2 @@", "+first", "+second"].join("\n")
    expect(VcsPatch.countPatch(patch)).toEqual({ additions: 2, deletions: 0 })
  })
})
