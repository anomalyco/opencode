import { afterEach, describe, expect, test } from "bun:test"
import { For } from "solid-js"
import { testRender, type JSX } from "@opentui/solid"
import { INLINE_TOOL_ICON_WIDTH } from "../../../src/routes/session/message-parts"
import { stringWidth } from "../../../src/util/string-width"
import {
  InlineToolRow,
  executeCallSummary,
  genericToolSummary,
  isBackgroundSubagent,
  parseApplyPatchFiles,
  parseDiagnostics,
  parseQuestionAnswers,
  parseQuestions,
  toolDisplay,
} from "../../../src/routes/session"

let testSetup: Awaited<ReturnType<typeof testRender>> | undefined

afterEach(() => {
  testSetup?.renderer.destroy()
  testSetup = undefined
})

type ToolFixture = { icon: string; label: string; error?: string }

const tools: readonly ToolFixture[] = [
  {
    icon: "✱",
    label:
      'Grep "OPENCODE.*DB|database|sqlite|drizzle|dev.*db|data.*dir|xdg|APPDATA" in packages/opencode/src (151 matches)',
  },
  {
    icon: "✱",
    label: 'Glob "**/*db*" in packages/opencode (6 matches)',
  },
  {
    icon: "→",
    label: "Read packages/opencode/src/storage/db.ts [offset=1, limit=130]",
  },
  {
    icon: "→",
    label: "Read packages/opencode/src/index.ts [offset=1, limit=100]",
    error: "No LSP server available for this file type.",
  },
  {
    icon: "✱",
    label:
      'Grep "export const OPENCODE_DB|OPENCODE_DB|OPENCODE_DEV|Global\\.Path\\.data|data =" in packages/opencode/src (115 matches)',
  },
] as const

function Fixture(props: { errorExpanded?: boolean }) {
  return (
    <box flexDirection="column" width={72}>
      <box flexDirection="column">
        <For each={tools}>
          {(item) => (
            <InlineToolRow
              icon={item.icon}
              complete={true}
              pending=""
              failed={Boolean(item.error)}
              error={item.error}
              errorExpanded={props.errorExpanded}
            >
              {item.label}
            </InlineToolRow>
          )}
        </For>
      </box>
    </box>
  )
}

function FailedPendingToolFixture() {
  return (
    <InlineToolRow icon="%" complete={false} pending="Preparing patch…" failed={true} failure="Patch failed">
      Patch
    </InlineToolRow>
  )
}

function FailedCompleteToolFixture() {
  return (
    <InlineToolRow icon="→" complete={true} pending="Reading file…" failed={true} failure="Read failed">
      Read src/index.ts
    </InlineToolRow>
  )
}

function ReminderAlignmentFixture() {
  return (
    <box flexDirection="column">
      <box paddingLeft={3}>
        <text>Switched variant to medium</text>
      </box>
      <InlineToolRow icon="◈" complete={true} pending="Notice">
        Instructions updated
      </InlineToolRow>
    </box>
  )
}

function TrailingStatusFixture() {
  return (
    <InlineToolRow icon=":" complete={true} pending="" status={<text flexShrink={0}> Background </text>}>
      Explore Subagent — Inspect renderer status styling
    </InlineToolRow>
  )
}

async function renderFrame(component: () => JSX.Element, options: { width: number; height: number }) {
  testSetup?.renderer.destroy()
  testSetup = await testRender(component, options)
  await testSetup.renderOnce()
  await testSetup.renderOnce()

  return testSetup
    .captureCharFrame()
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd()
}

describe("TUI inline tool wrapping", () => {
  test("falls back for unknown tool names", () => {
    expect(toolDisplay("shell")).toBe("shell")
    expect(toolDisplay("subagent")).toBe("subagent")
    // Legacy tool names normalize to their renamed views.
    expect(toolDisplay("bash")).toBe("shell")
    expect(toolDisplay("task")).toBe("subagent")
    expect(toolDisplay("apply_patch")).toBe("patch")
    expect(toolDisplay("patch")).toBe("patch")
    expect(toolDisplay("plugin_tool")).toBe("generic")
  })

  test("replaces pending copy when a tool fails before completion", async () => {
    const frame = await renderFrame(() => <FailedPendingToolFixture />, { width: 72, height: 3 })
    expect(frame).toContain("Patch failed")
    expect(frame).not.toContain("Preparing patch")
  })

  test("preserves useful completed copy when a tool fails", async () => {
    const frame = await renderFrame(() => <FailedCompleteToolFixture />, { width: 72, height: 3 })
    expect(frame).toContain("Read src/index.ts")
    expect(frame).not.toContain("Read failed")
  })

  test("aligns switch reminders with instruction reminders", async () => {
    expect(await renderFrame(() => <ReminderAlignmentFixture />, { width: 35, height: 2 })).toBe(
      "   Switched variant to medium\n   ◈ Instructions updated",
    )
  })

  test("wraps a trailing status as one padded item", async () => {
    expect(await renderFrame(() => <TrailingStatusFixture />, { width: 70, height: 2 })).toBe(
      "   : Explore Subagent — Inspect renderer status styling  Background",
    )
    expect(await renderFrame(() => <TrailingStatusFixture />, { width: 62, height: 2 })).toBe(
      "   : Explore Subagent — Inspect renderer status styling\n      Background",
    )
  })

  test("filters malformed nested tool wire data", () => {
    expect(
      parseApplyPatchFiles([
        null,
        { type: "add" },
        { file: "a.ts", patch: "diff", additions: 1, deletions: 0, status: "added" },
      ]),
    ).toEqual([
      {
        type: "add",
        relativePath: "a.ts",
        filePath: "a.ts",
        patch: "diff",
        additions: 1,
        deletions: 0,
        movePath: undefined,
      },
    ])
    expect(parseQuestions([{}, { question: 1 }, { question: "Continue?" }])).toEqual([{ question: "Continue?" }])
    expect(parseQuestionAnswers([null, ["yes", 1], "no"])).toEqual([[], ["yes"], []])
    expect(parseQuestionAnswers({})).toBeUndefined()
  })

  test("summarizes execute calls on one line", () => {
    expect(
      executeCallSummary({
        tool: "session.prompt",
        status: "completed",
        input: { sessionID: "ses_example", notify: true },
      }),
    ).toBe("session.prompt [sessionID=ses_example, notify=true]")
    expect(executeCallSummary({ tool: "session.get", status: "error", input: { nested: { hidden: true } } })).toBe(
      "session.get",
    )
    expect(
      executeCallSummary({ tool: "session.prompt", status: "completed", input: { text: "first line\nsecond line" } }),
    ).toBe("session.prompt [text=first line second line]")
  })

  test("summarizes generic tool arguments on one line", () => {
    expect(
      genericToolSummary(
        "demo_search_catalog",
        {
          query: "wireless keyboard",
          limit: 8,
          includeArchived: false,
          filters: { category: "accessories" },
        },
        100,
      ),
    ).toBe("demo_search_catalog [query=wireless keyboard, limit=8, includeArchived=false]")
    expect(genericToolSummary("demo_get_weather", { city: "Tokyo", units: "celsius" }, 100)).toBe(
      "demo_get_weather [city=Tokyo, units=celsius]",
    )
    expect(genericToolSummary("demo_refresh", {}, 100)).toBe("demo_refresh")
  })

  test.each([36, 72, 120])("keeps a 5000-character generic tool summary on one row at %i columns", async (width) => {
    const input = { content: "0123456789".repeat(500) }
    const frame = await renderFrame(
      () => (
        <InlineToolRow icon="✓" complete={true} pending="">
          {genericToolSummary("ingest_document", input, width - 3 - INLINE_TOOL_ICON_WIDTH)}
        </InlineToolRow>
      ),
      { width, height: 5 },
    )
    expect(frame.split("\n")).toHaveLength(1)
    expect(frame).toStartWith("   ✓ ingest_document [content=")
    expect(frame).toEndWith("…")
    expect(stringWidth(frame)).toBe(width)
    expect(input.content).toBe("0123456789".repeat(500))
  })

  test("truncates generic summaries by display width without splitting graphemes", () => {
    expect(genericToolSummary("tool", { text: "中文测试" }, 18)).toBe("tool [text=中文测…")
    expect(genericToolSummary("tool", { text: "👨‍👩‍👧‍👦".repeat(20) }, 16)).toBe("tool [text=👨‍👩‍👧‍👦👨‍👩‍👧‍👦…")
    expect(genericToolSummary("tool", { text: "e\u0301".repeat(20) }, 14)).toBe("tool [text=e\u0301e\u0301…")
  })

  test("bounds the whole generic summary, including tool names and multiple arguments", () => {
    expect(genericToolSummary("very_long_tool_name", {}, 8)).toBe("very_lo…")
    expect(genericToolSummary("tool", { a: "123", b: "456", c: "789" }, 21)).toBe("tool [a=123, b=456, …")
    expect(genericToolSummary("tool", { text: "first\nsecond\tthird" }, 100)).toBe("tool [text=first second third]")
    expect(genericToolSummary("tool", {}, 4)).toBe("tool")
    expect(genericToolSummary("tool", {}, 1)).toBe("…")
    expect(genericToolSummary("tool", {}, 0)).toBe("")
  })

  test("ignores diagnostics with malformed nested ranges", () => {
    expect(
      parseDiagnostics(
        {
          "a.ts": [
            { severity: 1, message: "missing range" },
            { severity: 1, message: "bad line", range: { start: { line: "0", character: 1 } } },
            { severity: 1, message: "valid", range: { start: { line: 2, character: 3 } } },
          ],
        },
        "a.ts",
      ),
    ).toEqual([{ message: "valid", range: { start: { line: 2, character: 3 } } }])
  })

  test("labels only detached or async subagents as background", () => {
    expect(isBackgroundSubagent({ status: "running" }, "running")).toBeFalse()
    expect(isBackgroundSubagent({ status: "running" }, "completed")).toBeTrue()
    expect(isBackgroundSubagent({ status: "running" }, "error")).toBeFalse()
    expect(isBackgroundSubagent({ status: "completed" }, "completed")).toBeFalse()
  })

  test("snapshots consecutive grep, glob, and read rows at a narrow width", async () => {
    expect(await renderFrame(() => <Fixture />, { width: 72, height: 12 })).toMatchSnapshot()
  })

  test("snapshots expanded tool errors under the tool text", async () => {
    expect(await renderFrame(() => <Fixture errorExpanded />, { width: 72, height: 12 })).toMatchSnapshot()
  })
})
