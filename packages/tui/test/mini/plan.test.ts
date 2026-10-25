import { describe, expect, test } from "bun:test"
import { collect, destructive, render, verdict } from "../../../src/cli/cmd/run/plan"

function bash(command: string) {
  return { tool: "bash", state: { status: "completed", input: { command }, output: "" } }
}

function write(filePath: string, output: string) {
  return { tool: "write", state: { status: "completed", input: { filePath }, output } }
}

describe("collect", () => {
  test("captures shell commands", () => {
    expect(collect(bash("bun test"))).toEqual({ kind: "command", detail: "bun test" })
  })

  test("captures writes with the reported diff", () => {
    const output = [
      "DRY RUN: no changes were made. This session is in dry-run mode, so file writes are reported instead of applied.",
      "",
      "Would modify src/a.ts:",
      "",
      "-old",
      "+new",
    ].join("\n")
    expect(collect(write("src/a.ts", output))).toEqual({ kind: "write", detail: "src/a.ts", diff: "-old\n+new" })
  })

  test("captures edits", () => {
    const part = { tool: "edit", state: { status: "completed", input: { filePath: "b.ts" }, output: "" } }
    expect(collect(part)?.kind).toBe("write")
  })

  test("ignores incomplete and unrelated tools", () => {
    expect(collect({ tool: "bash", state: { status: "running", input: { command: "x" } } })).toBeUndefined()
    expect(collect({ tool: "read", state: { status: "completed", input: { filePath: "a" } } })).toBeUndefined()
  })
})

describe("destructive", () => {
  test.each([
    ["rm -rf node_modules", "recursive or forced delete"],
    ["git push --force origin main", "force push"],
    ["git push -f", "force push"],
    ["git reset --hard HEAD~5", "hard reset"],
    ["git clean -fd", "git clean removes untracked files"],
    ["psql -c 'DROP TABLE users'", "drops a database object"],
    ["chmod -R 777 /srv", "world-writable permissions"],
    ["dd if=/dev/zero of=/dev/sda", "writes to a raw device"],
  ])("flags %s", (command, reason) => {
    expect(destructive({ kind: "command", detail: command })).toBe(reason)
  })

  test("allows ordinary commands", () => {
    expect(destructive({ kind: "command", detail: "bun test ./test" })).toBeUndefined()
    expect(destructive({ kind: "command", detail: "git push origin feature" })).toBeUndefined()
    expect(destructive({ kind: "command", detail: "rm build.log" })).toBeUndefined()
    expect(destructive({ kind: "command", detail: "DELETE FROM users WHERE id = 1" })).toBeUndefined()
  })

  test("flags writes to sensitive paths", () => {
    expect(destructive({ kind: "write", detail: ".env" })).toBe("modifies environment secrets")
    expect(destructive({ kind: "write", detail: "home/.ssh/config" })).toBe("modifies SSH configuration")
  })

  test("flags pure mass deletions", () => {
    const diff = Array.from({ length: 12 }, (item, index) => `-line ${index}`).join("\n")
    expect(destructive({ kind: "write", detail: "src/big.ts", diff })).toBe("removes 12 lines without adding any")
  })

  test("allows balanced rewrites", () => {
    expect(destructive({ kind: "write", detail: "src/a.ts", diff: "-old\n+new" })).toBeUndefined()
  })
})

describe("verdict and render", () => {
  test("verdict lists only destructive entries", () => {
    const entries = [
      { kind: "command" as const, detail: "bun test" },
      { kind: "command" as const, detail: "rm -rf dist" },
    ]
    const findings = verdict(entries)
    expect(findings).toHaveLength(1)
    expect(findings[0].entry.detail).toBe("rm -rf dist")
  })

  test("render shows commands and diffs", () => {
    const out = render([
      { kind: "command", detail: "bun install" },
      { kind: "write", detail: "src/a.ts", diff: "-old\n+new" },
    ])
    expect(out).toContain("Commands (1):")
    expect(out).toContain("$ bun install")
    expect(out).toContain("~ src/a.ts")
    expect(out).toContain("-old")
  })

  test("render handles an empty plan", () => {
    expect(render([])).toContain("no file writes or shell commands")
  })
})
