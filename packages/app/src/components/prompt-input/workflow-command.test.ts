import { describe, expect, test } from "bun:test"
import {
  extractReservedBudget,
  parseWorkflowArgs,
  parseWorkflowCommand,
  resolveDirectWorkflowCommand,
  sanitizeWorkflowFilename,
  workflowCommandOptions,
} from "./workflow-command"
import type { WorkflowInfo } from "@opencode-ai/sdk/v2"

const wf = (name: string, valid = true): WorkflowInfo => ({
  name,
  path: `/${name}.ts`,
  valid,
  meta: { name, description: `${name} desc` },
})

describe("parseWorkflowCommand", () => {
  test("/workflows opens dashboard", () => expect(parseWorkflowCommand("/workflows")).toEqual({ type: "dashboard" }))
  test("/workflow with no name opens dashboard", () =>
    expect(parseWorkflowCommand("/workflow")).toEqual({ type: "dashboard" }))
  test("/workflow <name> starts and keeps raw args", () =>
    expect(parseWorkflowCommand('/workflow review msg="a  b"')).toEqual({
      type: "start",
      name: "review",
      args: 'msg="a  b"',
    }))
  test("non-workflow input returns undefined", () => expect(parseWorkflowCommand("/share")).toBeUndefined())
})

describe("resolveDirectWorkflowCommand (Bonus A)", () => {
  const commands = [
    { name: "review", source: "workflow" },
    { name: "share", source: "command" },
    { name: "tools", source: "mcp" },
    { name: "legacy" },
  ]

  test("resolves a workflow-sourced /<name> with the RAW args remainder", () => {
    expect(resolveDirectWorkflowCommand('/review msg="a  b"  k=v', commands)).toEqual({
      type: "start",
      name: "review",
      args: 'msg="a  b"  k=v',
    })
    expect(resolveDirectWorkflowCommand("/review", commands)).toEqual({ type: "start", name: "review", args: "" })
  })
  test("non-workflow sources never match (command/mcp/undefined)", () => {
    expect(resolveDirectWorkflowCommand("/share x", commands)).toBeUndefined()
    expect(resolveDirectWorkflowCommand("/tools x", commands)).toBeUndefined()
    expect(resolveDirectWorkflowCommand("/legacy x", commands)).toBeUndefined()
    expect(resolveDirectWorkflowCommand("/unknown x", commands)).toBeUndefined()
  })
  test("requires a leading slash and a non-empty name", () => {
    expect(resolveDirectWorkflowCommand("review x", commands)).toBeUndefined()
    expect(resolveDirectWorkflowCommand("/", commands)).toBeUndefined()
    expect(resolveDirectWorkflowCommand("", commands)).toBeUndefined()
  })
  test("only the first line determines the command (parseWorkflowCommand parity)", () => {
    expect(resolveDirectWorkflowCommand("/review k=v\nsecond line", commands)).toEqual({
      type: "start",
      name: "review",
      args: "k=v",
    })
    expect(resolveDirectWorkflowCommand("plain text\n/review", commands)).toBeUndefined()
  })
  test("doc: the function only matches the NAME — '/workflow x' is the caller's job", () => {
    // The submit path consults parseWorkflowCommand first, so '/workflow x'
    // never reaches this resolver; on its own it just looks up 'workflow'.
    expect(resolveDirectWorkflowCommand("/workflow x", commands)).toBeUndefined()
  })
})

describe("parseWorkflowArgs", () => {
  test("coerces declared-number, keeps undeclared strings", () => {
    expect(parseWorkflowArgs("count=3 version=1.0", { count: { type: "number" } })).toEqual({
      count: 3,
      version: "1.0",
    })
  })
  test("keeps quoted value with spaces intact", () =>
    expect(parseWorkflowArgs('msg="a b"', {})).toEqual({ msg: "a b" }))
})

describe("extractReservedBudget", () => {
  test("number value sets budget and removes the key", () =>
    expect(extractReservedBudget({ budget: 5, msg: "hi" }, {})).toEqual({ args: { msg: "hi" }, budget: 5 }))
  test("numeric string and $-prefixed values parse", () => {
    expect(extractReservedBudget({ budget: "2.5" }, {})).toEqual({ args: {}, budget: 2.5 })
    expect(extractReservedBudget({ budget: "$5" }, {})).toEqual({ args: {}, budget: 5 })
  })
  test("budget=0 is valid (the engine allows a zero cap)", () =>
    expect(extractReservedBudget({ budget: "0" }, {})).toEqual({ args: {}, budget: 0 }))
  test("a workflow-declared budget argument passes through untouched", () =>
    expect(extractReservedBudget({ budget: "5" }, { budget: { type: "number" } })).toEqual({
      args: { budget: "5" },
    }))
  test("invalid values report the raw value so the caller can abort", () => {
    expect(extractReservedBudget({ budget: "abc" }, {}).invalid).toBe("abc")
    expect(extractReservedBudget({ budget: "-1" }, {}).invalid).toBe("-1")
    expect(extractReservedBudget({ budget: "" }, {}).invalid).toBe("")
  })
  test("no budget key passes through unchanged", () =>
    expect(extractReservedBudget({ msg: "hi" }, {})).toEqual({ args: { msg: "hi" } }))
})

describe("workflowCommandOptions", () => {
  test("drops invalid workflows and command-name collisions", () => {
    const out = workflowCommandOptions([wf("review"), wf("broken", false), wf("share")], new Set(["share"]))
    expect(out.map((o) => o.name)).toEqual(["review"])
  })
  test("carries the workflow description", () => {
    const out = workflowCommandOptions([wf("review")], new Set())
    expect(out[0]?.description).toBe("review desc")
  })
})

describe("sanitizeWorkflowFilename", () => {
  test("rejects traversal/separators, accepts a clean segment", () => {
    expect(sanitizeWorkflowFilename(" review ")).toBe("review")
    expect(sanitizeWorkflowFilename("a/b")).toBeUndefined()
    expect(sanitizeWorkflowFilename("..")).toBeUndefined()
  })
})
