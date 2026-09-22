import { describe, expect, test } from "bun:test"
import type { Vcs } from "@opencode/schema/vcs"
import { layoutGitGraph } from "./layout"

const commit = (hash: string, parents: string[] = []): Vcs.GraphCommit => ({
  hash,
  parents,
  refs: [],
  subject: hash,
  authorName: "Test",
  authoredAtMs: 1,
})

describe("layoutGitGraph", () => {
  test("keeps linear history in one lane and connects every visible parent", () => {
    const layout = layoutGitGraph([commit("c", ["b"]), commit("b", ["a"]), commit("a")])

    expect(layout.rows.map((row) => row.laneIndex)).toEqual([0, 0, 0])
    expect(layout.edges.map((edge) => [edge.fromHash, edge.toHash, edge.truncated])).toEqual([
      ["c", "b", false],
      ["b", "a", false],
    ])
  })

  test("lays out a merge with distinct lanes and both parent edges", () => {
    const layout = layoutGitGraph([
      commit("merge", ["main", "feature"]),
      commit("feature", ["base"]),
      commit("main", ["base"]),
      commit("base"),
    ])

    expect(layout.laneCount).toBeGreaterThan(1)
    expect(
      layout.edges
        .filter((edge) => edge.fromHash === "merge")
        .map((edge) => edge.toHash)
        .sort(),
    ).toEqual(["feature", "main"])
  })

  test("marks parents outside the loaded window without connecting them to another row", () => {
    const layout = layoutGitGraph([commit("b", ["outside"]), commit("a")])
    const edge = layout.edges[0]!

    expect(edge.toHash).toBe("outside")
    expect(edge.truncated).toBe(true)
    expect(layout.rows.some((row) => row.commit.hash === edge.toHash)).toBe(false)
    expect(layout.rows[0]?.truncated).toBe(true)
    expect(layout.rows[1]?.truncated).toBe(false)
  })

  test("keeps a commit's lane colour stable when earlier pages are appended", () => {
    const tail = layoutGitGraph([commit("merge", ["main", "feature"]), commit("feature", ["base"])])
    const full = layoutGitGraph([
      commit("merge", ["main", "feature"]),
      commit("feature", ["base"]),
      commit("main", ["base"]),
      commit("base"),
    ])
    const colourOf = (layout: ReturnType<typeof layoutGitGraph>, hash: string) =>
      layout.rows.find((row) => row.commit.hash === hash)?.colourIndex

    expect(colourOf(full, "merge")).toBe(colourOf(tail, "merge"))
    expect(colourOf(full, "feature")).toBe(colourOf(tail, "feature"))
    expect(colourOf(full, "base")).toBeDefined()
  })

  test("colours each node the same as the line continuing its own branch", () => {
    const layout = layoutGitGraph([
      commit("tip", ["merge"]),
      commit("merge", ["main", "feature"]),
      commit("feature", ["base"]),
      commit("main", ["base"]),
      commit("base"),
    ])

    for (const row of layout.rows) {
      const firstParent = row.commit.parents[0]
      if (!firstParent) continue
      const continuation = layout.paths.find(
        (path) => path.relatedHashes.includes(row.commit.hash) && path.relatedHashes.includes(firstParent),
      )
      expect(continuation).toBeDefined()
      expect(continuation!.colourIndex).toBe(row.colourIndex)
    }
  })

  test("recomputes a valid graph after another page is appended", () => {
    const first = layoutGitGraph([commit("merge", ["main", "feature"]), commit("feature", ["base"])])
    const appended = layoutGitGraph([
      commit("merge", ["main", "feature"]),
      commit("feature", ["base"]),
      commit("main", ["base"]),
      commit("base"),
    ])

    expect(first.edges.some((edge) => edge.truncated)).toBe(true)
    expect(appended.edges.every((edge) => !edge.truncated)).toBe(true)
    expect(appended.edges).toHaveLength(4)
  })
})
