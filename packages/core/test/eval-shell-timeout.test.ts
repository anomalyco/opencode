import { describe, expect, test } from "bun:test"
import { cases, messages, score, tools, type Case } from "../script/eval-shell-timeout"

const item = (id: Case["id"]) => {
  const found = cases.find((entry) => entry.id === id)
  if (!found) throw new Error(`Missing case ${id}`)
  return found
}
const shell = (input: unknown) => [{ name: "shell", input }]

describe("shell timeout eval scoring", () => {
  test("distinguishes a default kill budget from a foreground yield", () => {
    const calls = shell({ command: "node verify.mjs" })
    expect(score(item("long-result"), calls, false)).toMatchObject({ score: 0, killMs: 120_000 })
    expect(score(item("long-result"), calls, true)).toMatchObject({ score: 1, killMs: null })
  })

  test("does not mistake an inner command timeout for an outer override", () => {
    const calls = shell({ command: "timeout 600 node verify.mjs" })
    expect(score(item("inner-limit"), calls, false).score).toBe(0)
    expect(score(item("inner-limit"), calls, true).score).toBe(1)
    expect(
      score(item("inner-limit"), shell({ command: "timeout 600 node verify.mjs", timeout: 600_000 }), false).score,
    ).toBe(1)
  })

  test("zero waits indefinitely instead of yielding immediately", () => {
    const calls = shell({ command: "node server.mjs", timeout: 0 })
    expect(score(item("server"), calls, true)).toMatchObject({ score: 0, waitMs: null })
    expect(score(item("server"), shell({ command: "node server.mjs", background: true }), true).score).toBe(1)
  })

  test("a foreground yield does not satisfy a hard kill deadline", () => {
    const calls = shell({ command: "node worker.mjs", timeout: 5000 })
    expect(score(item("hard-deadline"), calls, false).score).toBe(1)
    expect(score(item("hard-deadline"), calls, true).score).toBe(0)
    expect(
      score(item("hard-deadline"), shell({ command: "node worker.mjs", background: true, timeout: 5000 }), true).score,
    ).toBe(1)
  })

  test("checks the existing handle and rejects restarting it", () => {
    expect(score(item("progress"), [{ name: "read", input: { path: "/workspace/verify.out" } }], true).score).toBe(1)
    expect(score(item("progress"), [{ name: "read", input: { path: "verify.out" } }], true).score).toBe(1)
    expect(score(item("progress"), shell({ command: "tail -n 50 verify.out" }), true).score).toBe(1)
    expect(
      score(item("progress"), shell({ command: "tail -n 50 verify.out", workdir: "/elsewhere" }), true).score,
    ).toBe(0)
    expect(score(item("progress"), shell({ command: "node verify.mjs" }), true)).toMatchObject({
      score: 0,
      duplicateLaunch: true,
    })
    expect(score(item("cancel"), [{ name: "shell_stop", input: { shellID: "sh_eval_running" } }], true).score).toBe(1)
    expect(score(item("cancel"), [{ name: "shell_stop", input: { shellID: "sh_other" } }], true).score).toBe(0)
  })

  test("rejects malformed and unknown tool calls", () => {
    expect(score(item("long-result"), shell({ command: "node verify.mjs", timeout: -1 }), true).score).toBe(0)
    expect(score(item("long-result"), shell(null), true).score).toBe(0)
    expect(score(item("long-result"), [{ name: "bash", input: { command: "node verify.mjs" } }], true).score).toBe(0)
  })

  test("uses production schema, descriptions and handoff text in both variants", () => {
    const before = tools(false)[0]
    const after = tools(true)[0]
    expect(before.function.name).toBe(after.function.name)
    expect(before.function.parameters).not.toEqual(after.function.parameters)
    expect(before.function.description).toContain("optional timeout")
    expect(after.function.description).toContain("move to the background")
    expect(JSON.stringify(messages(item("progress"), true))).toContain("Do not start another copy")
    expect(JSON.stringify(messages(item("progress"), false))).not.toContain("Do not start another copy")
  })
})
