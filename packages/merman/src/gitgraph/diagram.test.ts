import { describe, expect, test } from "bun:test"
import { MermaidSyntaxError } from "../diagnostics.js"
import { renderGitGraphDiagram } from "./diagram.js"
import { drawGitGraphDiagramGrid } from "./drawing.js"
import { isMermaidGitGraphDiagram, parseMermaidGitGraphDiagram } from "./parser.js"
import { renderGitGraphGridText } from "./render-grid.js"
import { resolveGitGraphStyleColors } from "./style.js"

describe("GitGraphDiagram", () => {
  test("detects and parses commits, branches, checkout, tags, types, and merges", () => {
    const diagram = parseMermaidGitGraphDiagram(`gitGraph TB:
      commit id: "init"
      branch feature order: 1
      commit id: "api" msg: "Add API" tag: "ready"
      checkout main
      commit id: "docs" type: HIGHLIGHT
      merge feature id: "merge-feature"`)

    expect(diagram).toEqual({
      direction: "TB",
      branches: [
        { name: "main", order: 0, head: "merge-feature" },
        { name: "feature", order: 1, head: "api" },
      ],
      commits: [
        { id: "init", tags: [], type: "NORMAL", branch: "main", parents: [] },
        { id: "api", message: "Add API", tags: ["ready"], type: "NORMAL", branch: "feature", parents: ["init"] },
        { id: "docs", tags: [], type: "HIGHLIGHT", branch: "main", parents: ["init"] },
        {
          id: "merge-feature",
          tags: [],
          type: "NORMAL",
          branch: "main",
          parents: ["docs", "api"],
        },
      ],
    })
  })

  test("renders branch and merge transitions beside compact labels", () => {
    const source = `gitGraph
      commit id: "baseline"
      branch refactor
      commit id: "extract-seam" msg: "Extract seam"
      commit id: "add-tests" tag: "ready"
      checkout main
      commit id: "unrelated-fix"
      merge refactor id: "land-refactor" tag: "v2"`

    expect(renderGitGraphDiagram(source)).toBe(`●    baseline
├─╮
│ ●  Extract seam
│ ●  add-tests  [refactor] [ready]
● │  unrelated-fix
◎─╯  land-refactor  [main] [v2]`)
  })

  test("uses deterministic generated ids", () => {
    expect(parseMermaidGitGraphDiagram("gitGraph\n commit\n commit").commits.map((commit) => commit.id)).toEqual([
      "commit-1",
      "commit-2",
    ])
  })

  test("supports shorthand messages and preserves branch heads without direct commits", () => {
    const diagram = parseMermaidGitGraphDiagram(`gitGraph
      commit "Initial release"
      branch feature
      checkout main
      commit id: next`)

    expect(diagram.commits[0]?.message).toBe("Initial release")
    expect(diagram.branches).toEqual([
      { name: "main", order: 0, head: "next" },
      { name: "feature", head: "commit-1" },
    ])
    expect(
      renderGitGraphDiagram(`gitGraph
      commit id: base
      branch feature
      checkout main
      commit id: next`),
    ).toContain("base  [feature]")
  })

  test("places unordered branches before explicitly ordered branches", () => {
    const diagram = parseMermaidGitGraphDiagram(`gitGraph
      commit id: base
      branch later order: 2
      checkout main
      branch ordinary
      checkout main
      branch earlier order: 1`)

    expect(diagram.branches.map((branch) => branch.name)).toEqual(["main", "ordinary", "earlier", "later"])
  })

  test("keeps comment markers inside quoted labels", () => {
    expect(parseMermaidGitGraphDiagram('gitGraph\n commit id: "release%%candidate" %% comment').commits[0]?.id).toBe(
      "release%%candidate",
    )
  })

  test("uses rounded routing for wide lane transitions", () => {
    expect(
      renderGitGraphDiagram(`gitGraph
        commit id: base
        branch one
        branch two
        commit id: work`),
    ).toBe(`●      base  [main] [one]
├───╮
    ●  work  [two]`)
  })

  test("preserves direction semantics while rendering vertically", () => {
    const source = "gitGraph BT:\n commit id: one"
    const diagram = parseMermaidGitGraphDiagram(source)
    expect(diagram.direction).toBe("BT")
    expect(renderGitGraphGridText(drawGitGraphDiagramGrid(diagram, { direction: "LR" }))).toBe(
      renderGitGraphDiagram(source),
    )
  })

  test("reports semantic failures with source diagnostics", () => {
    expect(() => parseMermaidGitGraphDiagram("gitGraph\n checkout missing")).toThrow(
      new MermaidSyntaxError("gitGraph", 2, "checkout missing", 'Unknown branch "missing"'),
    )
    expect(() => parseMermaidGitGraphDiagram("gitGraph\n cherry-pick id: one")).toThrow(
      new MermaidSyntaxError("gitGraph", 2, "cherry-pick id: one", "Cherry-pick is not supported"),
    )
    expect(() => parseMermaidGitGraphDiagram("gitGraph\n commit id: same\n commit id: same")).toThrow(
      'Duplicate commit id "same"',
    )
    expect(() => parseMermaidGitGraphDiagram("gitGraph\n branch feature\n checkout main\n branch feature")).toThrow(
      'Duplicate branch "feature"',
    )
    expect(() =>
      parseMermaidGitGraphDiagram("gitGraph\n branch feature\n commit id: work\n checkout main\n merge feature"),
    ).toThrow('Branch "main" has no commits')
  })

  test("draws semantic styles for rails, commit types, merges, and labels", () => {
    const grid = drawGitGraphDiagramGrid(
      parseMermaidGitGraphDiagram(`gitGraph
        commit id: base
        branch feature
        commit id: work type: REVERSE
        checkout main
        commit id: checkpoint type: HIGHLIGHT
        merge feature id: done`),
    )
    const styles = new Set(grid.rows.flatMap((row) => row.map((cell) => cell.style).filter(Boolean)))

    expect(styles).toEqual(new Set(["branch0", "branch1", "commit", "reverse", "highlight", "merge", "label"]))
    expect(Object.keys(resolveGitGraphStyleColors()).sort()).toEqual(
      [
        "branch0",
        "branch1",
        "branch2",
        "branch3",
        "branch4",
        "branch5",
        "branch6",
        "branch7",
        "commit",
        "highlight",
        "label",
        "merge",
        "reverse",
      ].sort(),
    )
  })

  test("recognizes only GitGraph headers", () => {
    expect(isMermaidGitGraphDiagram("%% comment\ngitGraph LR:\n commit")).toBe(true)
    expect(isMermaidGitGraphDiagram("graph LR\n A --> B")).toBe(false)
    expect(() => parseMermaidGitGraphDiagram("commit id: missing-header")).toThrow("GitGraph header is required")
    expect(() => parseMermaidGitGraphDiagram("gitGraph\n commit\n gitGraph")).toThrow(
      "GitGraph header can only appear once",
    )
  })
})
