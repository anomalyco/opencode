import { beforeAll, describe, expect, mock, test } from "bun:test"
import type { ToolPart, ToolState } from "@opencode-ai/sdk/v2/client"

// Pure-function coverage for the terminal-state reader ported from the CLI footer
// (`packages/opencode/src/cli/cmd/run/subagent-data.ts:295-309`). Nothing is rendered here, but the
// module under test is a `.tsx` whose transitive `@solidjs/router` import evaluates client-only APIs
// at module scope, so it is stubbed the same way `src/components/file-tree.test.ts` does.
let text: typeof import("./session-agents-tab").text
let taskMetadata: typeof import("./session-agents-tab").taskMetadata
let taskSessionID: typeof import("./session-agents-tab").taskSessionID
let taskStatus: typeof import("./session-agents-tab").taskStatus

beforeAll(async () => {
  await mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
    useLocation: () => ({}),
    useSearchParams: () => [{}, () => undefined],
  }))
  const mod = await import("./session-agents-tab")
  text = mod.text
  taskMetadata = mod.taskMetadata
  taskSessionID = mod.taskSessionID
  taskStatus = mod.taskStatus
})

const input = {}
const time = { start: 1, end: 2 }

function part(state: ToolState, metadata?: Record<string, unknown>): ToolPart {
  return {
    id: "prt_test",
    sessionID: "ses_parent",
    messageID: "msg_parent",
    type: "tool",
    callID: "call_test",
    tool: "task",
    state,
    ...(metadata ? { metadata } : {}),
  }
}

function pending(): ToolState {
  return { status: "pending", input, raw: "" }
}

function failed(error: string, metadata?: Record<string, unknown>): ToolState {
  return { status: "error", input, error, time, ...(metadata ? { metadata } : {}) }
}

function completed(output: string): ToolState {
  return { status: "completed", input, output, title: "", metadata: {}, time }
}

describe("taskStatus", () => {
  const cases: [string, string, ToolPart][] = [
    ["completed wire status", "completed", part(completed(""))],
    ["completed with ordinary output", "completed", part(completed("Task completed in 4s."))],
    // The `task` tool the user actually runs finalizes an abort as a successful result and signals it only
    // in the output's first line - see `.omo/evidence/subagents-tab-cleanup/F3-manual-qa.md` section 5.
    ["completed with the long-running abort line", "cancelled", part(completed("Task aborted.\nRan for 12s."))],
    ["completed with the bare abort line", "cancelled", part(completed("Aborted"))],
    ["completed mentioning abort mid-line", "completed", part(completed("Successfully handled an abort case"))],
    ["completed with abort after the first line", "completed", part(completed("Task completed in 4s.\nAborted"))],
    ["error refined by state.metadata.interrupted", "cancelled", part(failed("boom", { interrupted: true }))],
    ["error refined by part.metadata.interrupted", "cancelled", part(failed("boom"), { interrupted: true })],
    ["error carrying the abort sentinel", "cancelled", part(failed("Tool execution aborted"))],
    ["error carrying the abort sentinel padded", "cancelled", part(failed("  Tool execution aborted  "))],
    ["error with any other message", "error", part(failed("ENOENT"))],
    ["error with a non-boolean interrupted marker", "error", part(failed("boom", { interrupted: "true" }))],
    ["error with an empty message", "error", part(failed(""))],
    ["running wire status", "running", part({ status: "running", input, time: { start: 1 } })],
    ["pending wire status", "running", part(pending())],
  ]

  test.each(cases)("%s maps to %p", (_name, expected, fixture) => {
    expect(taskStatus(fixture)).toBe(expected)
  })

  test("an unmapped wire status falls back to running instead of throwing", () => {
    const unmapped = part({ status: "queued", input, time } as unknown as ToolState)
    expect(() => taskStatus(unmapped)).not.toThrow()
    expect(taskStatus(unmapped)).toBe("running")
  })

  test("a state with no metadata carrier at all does not throw", () => {
    expect(taskStatus(part(pending()))).toBe("running")
  })
})

describe("taskMetadata", () => {
  test("prefers the state carrier over the part carrier", () => {
    expect(taskMetadata(part(failed("boom", { sessionId: "ses_state" }), { sessionId: "ses_part" }), "sessionId")).toBe(
      "ses_state",
    )
  })

  test("falls back to the part carrier when the state has no metadata", () => {
    expect(taskMetadata(part(pending(), { sessionId: "ses_part" }), "sessionId")).toBe("ses_part")
  })

  test("is undefined when neither carrier holds the key", () => {
    expect(taskMetadata(part(pending()), "sessionId")).toBeUndefined()
  })
})

describe("taskSessionID", () => {
  test("reads the lowercase-d spelling", () => {
    expect(taskSessionID(part(pending(), { sessionId: "ses_child" }))).toBe("ses_child")
  })

  test("reads the uppercase-D spelling", () => {
    expect(taskSessionID(part(pending(), { sessionID: "ses_child" }))).toBe("ses_child")
  })

  test("ignores a blank id so a pending part never joins on an empty key", () => {
    expect(taskSessionID(part(pending(), { sessionId: "   " }))).toBeUndefined()
    expect(taskSessionID(part(pending()))).toBeUndefined()
  })
})

describe("text", () => {
  const cases: [unknown, string | undefined][] = [
    ["ses_child", "ses_child"],
    ["  padded  ", "padded"],
    ["", undefined],
    ["   ", undefined],
    [undefined, undefined],
    [null, undefined],
    [42, undefined],
    [true, undefined],
    [{}, undefined],
  ]

  test.each(cases)("text(%p) is %p", (value, expected) => {
    expect(text(value)).toBe(expected)
  })
})
