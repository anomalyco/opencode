import { describe, expect, test } from "bun:test"
import { VcsPatch } from "@opencode/core/vcs/patch"

describe("VcsPatch.countPatch", () => {
  test("counts header-like content inside hunks", () => {
    const added = "++counter\n++ heading\n+++\n"
    const removed = "--counter\n-- heading\n---\n"

    expect(VcsPatch.countPatch(VcsPatch.addPatch("counter.txt", added))).toEqual({ additions: 3, deletions: 0 })
    expect(VcsPatch.countPatch(VcsPatch.deletePatch("counter.txt", removed))).toEqual({ additions: 0, deletions: 3 })
  })

  test("ignores file headers between multiple patches", () => {
    const patch = VcsPatch.addPatch("added.txt", "++ added\n") + VcsPatch.deletePatch("removed.txt", "-- removed\n")
    expect(VcsPatch.countPatch(patch)).toEqual({ additions: 1, deletions: 1 })
    expect(VcsPatch.countPatch("diff --git a/empty b/empty\nnew file mode 100644\n")).toEqual({
      additions: 0,
      deletions: 0,
    })
  })
})
