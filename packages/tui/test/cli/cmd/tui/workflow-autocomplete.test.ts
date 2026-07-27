import { describe, expect, test } from "bun:test"
import type { TextareaRenderable } from "@opentui/core"
import type { WorkflowInfo } from "@opencode-ai/sdk/v2"
import {
  extractReservedBudget,
  isWorkflowCommandInput,
  isWorkflowNameInput,
  listWorkflowInfos,
  parseWorkflowArgs,
  reservedSlashNames,
  workflowArgContext,
  workflowArgOptions,
  workflowAutocompleteTriggerIndex,
  workflowCommandOptions,
} from "../../../../src/component/prompt/workflow-autocomplete"

describe("parseWorkflowArgs", () => {
  test("coerces only args declared as number", () => {
    const decl = { zip: { type: "string" }, count: { type: "number" } }
    expect(parseWorkflowArgs("zip=01234 count=42", decl)).toEqual({ zip: "01234", count: 42 })
  })

  test("string-declared numeric-looking values keep their exact text", () => {
    expect(parseWorkflowArgs("version=1.0", { version: { type: "string" } })).toEqual({ version: "1.0" })
  })

  test("string-declared values preserve leading zeros", () => {
    expect(parseWorkflowArgs("zip=01234", { zip: { type: "string" } })).toEqual({ zip: "01234" })
  })

  test("undeclared args stay strings", () => {
    expect(parseWorkflowArgs("foo=123", {})).toEqual({ foo: "123" })
  })

  test("undeclared args stay strings even without a declaration argument", () => {
    expect(parseWorkflowArgs("foo=123")).toEqual({ foo: "123" })
  })

  test("number-declared args that are not numeric pass through as raw strings", () => {
    expect(parseWorkflowArgs("count=abc", { count: { type: "number" } })).toEqual({ count: "abc" })
  })

  test("number-declared args coerce normal integers and floats", () => {
    expect(parseWorkflowArgs("count=42 ratio=1.5", { count: { type: "number" }, ratio: { type: "number" } })).toEqual({
      count: 42,
      ratio: 1.5,
    })
  })

  test("quoted values are unquoted and never coerced when declared string", () => {
    expect(parseWorkflowArgs('name="123"', { name: { type: "string" } })).toEqual({ name: "123" })
  })

  test("bare flags stay the string 'true' regardless of declaration (existing behavior)", () => {
    expect(parseWorkflowArgs("--verbose", { verbose: { type: "boolean" } })).toEqual({ verbose: "true" })
  })

  test("multi-space quoted values are preserved verbatim (Fund 60)", () => {
    expect(parseWorkflowArgs('msg="hello   world"')).toEqual({ msg: "hello   world" })
  })

  test("pathological input does not catastrophically backtrack (N14)", () => {
    const pathological = "=".concat('="'.repeat(50))
    const start = performance.now()
    parseWorkflowArgs(pathological)
    expect(performance.now() - start).toBeLessThan(100)
  })

  test("a long unterminated-quote run still parses fast (N14)", () => {
    const pathological = `name=${'"a'.repeat(50)}`
    const start = performance.now()
    parseWorkflowArgs(pathological)
    expect(performance.now() - start).toBeLessThan(100)
  })
})

describe("workflowArgContext (N6 — quote-aware used set)", () => {
  test("a quoted value with spaces counts the whole token as one used arg", () => {
    // Cursor at end; the only declared arg consumed so far is `msg` even though
    // its value contains a space. A naive whitespace split would have seen `b"`
    // as a separate bare token and missed that `msg` is already used.
    const ctx = workflowArgContext('/workflow flow msg="a b" ', '/workflow flow msg="a b" '.length)
    expect(ctx?.used.has("msg")).toBe(true)
    expect(ctx?.used.has("b")).toBe(false)
    expect(ctx?.used.has('b"')).toBe(false)
  })

  test("collects flag and key= forms in the used set", () => {
    const input = "/workflow flow --verbose count=3 "
    const ctx = workflowArgContext(input, input.length)
    expect(ctx?.used.has("verbose")).toBe(true)
    expect(ctx?.used.has("count")).toBe(true)
  })

  test("a cursor in the middle of a fresh token reports it as the query", () => {
    const input = "/workflow flow ms"
    const ctx = workflowArgContext(input, input.length)
    expect(ctx?.query).toBe("ms")
    expect(ctx?.used.has("ms")).toBe(false)
  })

  test("a trailing space yields an empty query ready for a new arg", () => {
    const input = "/workflow flow count=3 "
    const ctx = workflowArgContext(input, input.length)
    expect(ctx?.query).toBe("")
    expect(ctx?.used.has("count")).toBe(true)
  })
})

describe("workflow command/name input detection", () => {
  test("isWorkflowCommandInput recognizes the /workflow prefix", () => {
    expect(isWorkflowCommandInput("/workflow ")).toBe(true)
    expect(isWorkflowCommandInput("/help")).toBe(false)
  })

  test("isWorkflowNameInput is true while typing the name", () => {
    expect(isWorkflowNameInput("/workflow rev", "/workflow rev".length)).toBe(true)
    expect(isWorkflowNameInput("/workflow rev arg=1", "/workflow rev arg=1".length)).toBe(false)
  })

  test("workflowAutocompleteTriggerIndex anchors at the name slot", () => {
    expect(workflowAutocompleteTriggerIndex("/workflow re", "/workflow re".length)).toBe("/workflow ".length - 1)
  })
})

describe("listWorkflowInfos", () => {
  const valid = { name: "a", valid: true, meta: { name: "a" } } as unknown as WorkflowInfo
  const broken = { name: "b", valid: false, meta: { name: "b" } } as unknown as WorkflowInfo

  test("disabled never calls list()", async () => {
    let called = false
    const result = await listWorkflowInfos(
      {
        list: async () => {
          called = true
          return { data: [valid] }
        },
      },
      false,
    )
    expect(called).toBe(false)
    expect(result).toEqual([])
  })

  test("an error response yields an empty list", async () => {
    expect(await listWorkflowInfos({ list: async () => ({ error: "boom" }) }, true)).toEqual([])
  })

  test("an undefined data response yields an empty list", async () => {
    expect(await listWorkflowInfos({ list: async () => ({ data: undefined }) }, true)).toEqual([])
  })

  test("invalid entries are filtered out", async () => {
    const result = await listWorkflowInfos({ list: async () => ({ data: [valid, broken] }) }, true)
    expect(result.map((info) => info.name)).toEqual(["a"])
  })
})

describe("workflowCommandOptions (direct /<name> slash commands)", () => {
  const info = (name: string, extra: Partial<WorkflowInfo> = {}) =>
    ({ name, valid: true, path: `p/${name}`, meta: { name, description: `${name} desc` }, ...extra }) as WorkflowInfo

  test("valid workflows become /<name> options carrying the name as value", () => {
    const options = workflowCommandOptions([info("review"), info("deploy")], new Set())
    expect(options.map((o) => o.display)).toEqual(["/review", "/deploy"])
    expect(options.map((o) => o.value)).toEqual(["review", "deploy"])
    expect(options.map((o) => o.description)).toEqual(["review desc", "deploy desc"])
  })

  test("falls back to meta.name when no description is present", () => {
    const options = workflowCommandOptions(
      [info("solo", { meta: { name: "Solo Flow" } } as Partial<WorkflowInfo>)],
      new Set(),
    )
    expect(options[0]?.description).toBe("Solo Flow")
  })

  test("invalid workflows are filtered out", () => {
    const options = workflowCommandOptions(
      [info("good"), { name: "bad", valid: false, path: "p/bad", meta: { name: "bad" } } as WorkflowInfo],
      new Set(),
    )
    expect(options.map((o) => o.display)).toEqual(["/good"])
  })

  test("a workflow whose name collides with an existing command is filtered out", () => {
    const options = workflowCommandOptions([info("review"), info("deploy")], new Set(["review"]))
    expect(options.map((o) => o.display)).toEqual(["/deploy"])
  })

  test("no infos yields no options", () => {
    expect(workflowCommandOptions([], new Set())).toEqual([])
  })
})

describe("reservedSlashNames (Item 30 — Commands > Workflows collision set)", () => {
  test("palette slash displays are reserved with the leading slash stripped", () => {
    const names = reservedSlashNames([{ display: "/help" }, { display: "/models" }], [])
    expect(names.has("help")).toBe(true)
    expect(names.has("models")).toBe(true)
  })

  test("palette slash aliases are reserved too (a typed alias is a real command trigger)", () => {
    const names = reservedSlashNames([{ display: "/quit", aliases: ["/exit", "/q"] }], [])
    expect(names.has("quit")).toBe(true)
    expect(names.has("exit")).toBe(true)
    expect(names.has("q")).toBe(true)
  })

  test("server command/mcp/skill names are reserved; a :mcp display suffix is stripped defensively", () => {
    const names = reservedSlashNames(
      [],
      [
        { name: "deploy", source: "command" },
        { name: "tools:mcp", source: "mcp" },
        { name: "brainstorm", source: "skill" },
        { name: "plain" },
      ],
    )
    expect(names.has("deploy")).toBe(true)
    expect(names.has("tools")).toBe(true)
    expect(names.has("brainstorm")).toBe(true)
    expect(names.has("plain")).toBe(true)
  })

  test("source-'workflow' entries are NOT reserved (discovery mirrors of the workflows themselves)", () => {
    const names = reservedSlashNames([], [{ name: "review", source: "workflow" }])
    expect(names.has("review")).toBe(false)
  })

  test("the /workflow[s] dispatch words are always reserved", () => {
    const names = reservedSlashNames([], [])
    expect(names.has("workflow")).toBe(true)
    expect(names.has("workflows")).toBe(true)
  })

  test("a name in the set blocks direct routing, an unknown one does not", () => {
    const names = reservedSlashNames([{ display: "/review" }], [])
    expect(names.has("review")).toBe(true)
    expect(names.has("triage")).toBe(false)
  })
})

describe("extractReservedBudget (reserved budget= argument)", () => {
  test("undeclared + valid value sets budget and removes the key", () => {
    expect(extractReservedBudget({ budget: "5", msg: "hi" })).toEqual({ args: { msg: "hi" }, budget: 5 })
    expect(extractReservedBudget({ budget: "0.5" })).toEqual({ args: {}, budget: 0.5 })
  })

  test("a leading $ is tolerated (budget=$5)", () => {
    expect(extractReservedBudget({ budget: "$5" })).toEqual({ args: {}, budget: 5 })
  })

  test("budget=0 is valid (the engine allows a zero cap)", () => {
    expect(extractReservedBudget({ budget: "0" })).toEqual({ args: {}, budget: 0 })
  })

  test("a workflow-declared budget argument wins — passthrough untouched", () => {
    const args = { budget: "5" }
    expect(extractReservedBudget(args, { budget: { type: "number" } })).toEqual({ args: { budget: "5" } })
  })

  test("invalid values report an error and keep the args", () => {
    expect(extractReservedBudget({ budget: "abc" })).toEqual({
      args: { budget: "abc" },
      error: "Invalid budget value: abc",
    })
    expect(extractReservedBudget({ budget: "-1" }).error).toBe("Invalid budget value: -1")
    expect(extractReservedBudget({ budget: "" }).error).toBe("Invalid budget value: ")
  })

  test("no budget key passes through unchanged", () => {
    expect(extractReservedBudget({ msg: "hi" })).toEqual({ args: { msg: "hi" } })
    expect(extractReservedBudget({})).toEqual({ args: {} })
  })
})

describe("workflowArgOptions (synthetic budget= option)", () => {
  const input = {} as TextareaRenderable
  const ctx = (used: string[] = []) => ({ workflow: "flow", query: "", used: new Set(used) })
  const info = (args: Record<string, { type?: string }>) =>
    ({ name: "flow", valid: true, meta: { name: "flow", arguments: args } }) as unknown as WorkflowInfo

  test("offers budget= when neither declared nor used", () => {
    const options = workflowArgOptions(input, ctx(), info({ msg: { type: "string" } }))
    expect(options.map((option) => option.display)).toEqual(["msg=", "budget="])
    expect(options.at(-1)?.description).toBe("reserved · USD cost cap for this run")
  })

  test("omits budget= when the workflow declares its own budget argument", () => {
    const options = workflowArgOptions(input, ctx(), info({ budget: { type: "number" } }))
    expect(options.map((option) => option.display)).toEqual(["budget="])
    expect(options[0]?.description).toContain("number")
    expect(options[0]?.description).not.toContain("reserved")
  })

  test("omits budget= once it is already used in the input", () => {
    const options = workflowArgOptions(input, ctx(["budget"]), info({ msg: { type: "string" } }))
    expect(options.map((option) => option.display)).toEqual(["msg="])
  })

  test("offers budget= even for a workflow without declared arguments", () => {
    const options = workflowArgOptions(input, ctx(), info({}))
    expect(options.map((option) => option.display)).toEqual(["budget="])
  })
})
