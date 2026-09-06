import { describe, expect, test } from "bun:test"
import { containsHedge, extractHedges, hedgeScore } from "@opencode-ai/core/session/runner/hedge"

describe("containsHedge", () => {
  test("matches real hedges", () => {
    expect(containsHedge("I think this is the problem.")).toBe(true)
    expect(containsHedge("It might work if we restart.")).toBe(true)
    expect(containsHedge("Perhaps we should check the database.")).toBe(true)
    expect(containsHedge("This is likely caused by network latency.")).toBe(true)
    expect(containsHedge("Maybe we can try a different approach.")).toBe(true)
  })

  test("does not match substrings in other words (word-boundary check)", () => {
    expect(containsHedge("The algorithm is fast.")).toBe(false)
    expect(containsHedge("He gave a mighty push.")).toBe(false)
    expect(containsHedge("The almighty power.")).toBe(false)
    expect(containsHedge("She wore Maybelline makeup.")).toBe(false)
  })

  test("ignores code blocks, inline code, and blockquotes", () => {
    expect(containsHedge("Here is the code:\n```\nconst might = true\n```")).toBe(false)
    expect(containsHedge("Check the `maybe` variable.")).toBe(false)
    expect(containsHedge("> perhaps we can do this\nThis is definite.")).toBe(false)
  })
})

describe("extractHedges & hedgeScore", () => {
  test("extracts distinct hedge phrases", () => {
    const hedges = extractHedges("Maybe we should check, because perhaps the server crashed.")
    expect(hedges).toContain("maybe")
    expect(hedges).toContain("perhaps")
    expect(hedges.length).toBe(2)
  })

  test("calculates proportional hedge density score", () => {
    expect(hedgeScore("This is confirmed and verified.")).toBe(0)
    const score = hedgeScore("Maybe perhaps possibly it might fail.")
    expect(score).toBeGreaterThan(0.5)
  })
})

describe("isDestructiveCommand & shouldRedTeam", () => {
  test("detects destructive shell commands", () => {
    const { isDestructiveCommand } = require("@opencode-ai/core/session/runner/hedge")
    expect(isDestructiveCommand("rm -rf /tmp/data")).toBe(true)
    expect(isDestructiveCommand("git reset --hard HEAD~1")).toBe(true)
    expect(isDestructiveCommand("git checkout -- .")).toBe(true)
    expect(isDestructiveCommand("kill -9 12345")).toBe(true)
    expect(isDestructiveCommand("DROP TABLE users;")).toBe(true)
    expect(isDestructiveCommand("git status")).toBe(false)
    expect(isDestructiveCommand("cat README.md")).toBe(false)
  })

  test("shouldRedTeam triggers on mutative tools and hedged actions", () => {
    const { shouldRedTeam } = require("@opencode-ai/core/session/runner/hedge")
    // Mutating tools always trigger red-team
    expect(shouldRedTeam("write", { path: "foo.ts" }, "Confident plan")).toBe(true)
    expect(shouldRedTeam("edit", { path: "foo.ts" }, "Confident plan")).toBe(true)
    expect(shouldRedTeam("apply_patch", {}, "Confident plan")).toBe(true)

    // Destructive bash triggers red-team even without hedges
    expect(shouldRedTeam("bash", { command: "rm -rf build/" }, "Confident plan")).toBe(true)

    // Safe bash with hedges triggers red-team
    expect(shouldRedTeam("bash", { command: "systemctl restart app" }, "Maybe this fixes it")).toBe(true)

    // Safe read-only tools without hedges bypass red-team for speed
    expect(shouldRedTeam("read", { path: "foo.ts" }, "Looking up file")).toBe(false)
    expect(shouldRedTeam("grep", { query: "foo" }, "Searching definitions")).toBe(false)
    expect(shouldRedTeam("glob", { pattern: "*.ts" }, "Finding sources")).toBe(false)
  })
})

describe("heuristicAttack", () => {
  test("rejects dangerous destructive commands", () => {
    const { heuristicAttack } = require("@opencode-ai/core/session/runner/hedge")
    const rejectRoot = heuristicAttack("bash", { command: "rm -rf /" }, "Clean up everything")
    expect(rejectRoot.survives).toBe(false)
    expect(rejectRoot.critique).toContain("Dangerous wildcard or root deletion")

    const rejectWildcard = heuristicAttack("bash", { command: "rm -rf *" }, "Reset files")
    expect(rejectWildcard.survives).toBe(false)

    const rejectUncertainReset = heuristicAttack(
      "bash",
      { command: "git reset --hard HEAD" },
      "I think maybe this resets properly",
    )
    expect(rejectUncertainReset.survives).toBe(false)
    expect(rejectUncertainReset.critique).toContain("Hard git reset proposed under epistemic uncertainty")
  })

  test("rejects invalid write/edit target paths", () => {
    const { heuristicAttack } = require("@opencode-ai/core/session/runner/hedge")
    const rejectRootWrite = heuristicAttack("write", { path: "/" }, "Create config")
    expect(rejectRootWrite.survives).toBe(false)
    expect(rejectRootWrite.critique).toContain("Invalid target path")

    const rejectEmptyEdit = heuristicAttack("edit", { path: "" }, "Fix bug")
    expect(rejectEmptyEdit.survives).toBe(false)
  })

  test("survives valid safe actions", () => {
    const { heuristicAttack } = require("@opencode-ai/core/session/runner/hedge")
    const surviveValidWrite = heuristicAttack("write", { path: "src/index.ts" }, "Write implementation")
    expect(surviveValidWrite.survives).toBe(true)

    const surviveValidRead = heuristicAttack("read", { path: "src/index.ts" }, "Read file")
    expect(surviveValidRead.survives).toBe(true)
  })
})
