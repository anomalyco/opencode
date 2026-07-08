import { afterEach, describe, expect, test } from "bun:test"
import { For } from "solid-js"
import { testRender, type JSX } from "@opentui/solid"
import {
  formatCompletedSubagentDetail,
  formatSubagentRetry,
  formatSubagentTitle,
  formatSubagentToolcalls,
  InlineToolRow,
  parseApplyPatchFiles,
  parseDiagnostics,
  parseQuestionAnswers,
  parseQuestions,
  parseTodos,
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
    <InlineToolRow icon="%" complete={false} pending="Preparing patch..." failed={true} failure="Patch failed">
      Patch
    </InlineToolRow>
  )
}

function FailedCompleteToolFixture() {
  return (
    <InlineToolRow icon="→" complete={true} pending="Reading file..." failed={true} failure="Read failed">
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

async function renderFrame(component: () => JSX.Element, options: { width: number; height: number }) {
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
    expect(parseTodos([null, { status: "pending" }, { status: "pending", content: "Safe" }])).toEqual([
      { status: "pending", content: "Safe" },
    ])
    expect(parseQuestions([{}, { question: 1 }, { question: "Continue?" }])).toEqual([{ question: "Continue?" }])
    expect(parseQuestionAnswers([null, ["yes", 1], "no"])).toEqual([[], ["yes"], []])
    expect(parseQuestionAnswers({})).toBeUndefined()
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

  test("formats completed subagent toolcall details", () => {
    expect(formatCompletedSubagentDetail(0, "501ms")).toBe("501ms")
    expect(formatCompletedSubagentDetail(1, "501ms")).toBe("1 toolcall · 501ms")
    expect(formatCompletedSubagentDetail(2, "501ms")).toBe("2 toolcalls · 501ms")
    expect(formatSubagentToolcalls(0)).toBe("0 toolcalls")
  })

  test("keeps background state attached to the subagent identity", () => {
    expect(formatSubagentTitle("Explore", "Inspect renderer", false)).toBe("Explore Subagent — Inspect renderer")
    expect(formatSubagentTitle("Explore", "Inspect renderer", true)).toBe(
      "Explore Subagent — Inspect renderer [background]",
    )
  })

  test("keeps retry status ahead of wrapping messages", () => {
    expect(formatSubagentRetry(2, "Rate limited by provider")).toBe("Retrying (attempt 2) · Rate limited by provider")
  })

  test("snapshots consecutive grep, glob, and read rows at a narrow width", async () => {
    expect(await renderFrame(() => <Fixture />, { width: 72, height: 12 })).toMatchSnapshot()
  })

  test("snapshots expanded tool errors under the tool text", async () => {
    expect(await renderFrame(() => <Fixture errorExpanded />, { width: 72, height: 12 })).toMatchSnapshot()
  })

})
