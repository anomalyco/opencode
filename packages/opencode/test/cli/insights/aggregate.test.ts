import { describe, expect, test } from "bun:test"
import { extractSessionMeta, aggregate } from "@/insights/aggregate"

const fixtureSession = (id: string, created: number, updated: number) => ({
  id,
  projectID: "p1",
  directory: "/tmp/p1",
  time: { created, updated },
})

describe("extractSessionMeta", () => {
  test("counts edit lines and tool errors", () => {
    const meta = extractSessionMeta(fixtureSession("s1", 0, 60_000), [
      {
        info: {
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-opus-4-7",
          agent: "build",
          time: { created: 1_000 },
          tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.01,
        },
        parts: [
          {
            type: "tool",
            tool: "edit",
            state: {
              status: "completed",
              input: { file_path: "/x.ts", old_string: "a\n", new_string: "a\nb\nc\n" },
            },
          },
          {
            type: "tool",
            tool: "bash",
            state: { status: "error", input: {}, error: "exit code 1\nboom" },
          },
        ],
      } as any,
      {
        info: { role: "user", time: { created: 5_000 } },
        parts: [{ type: "text", text: "hello" }],
      } as any,
    ])
    expect(meta.lines_added).toBeGreaterThanOrEqual(2)
    expect(meta.tool_errors).toBe(1)
    expect(meta.tool_error_categories["Command Failed"]).toBe(1)
    expect(meta.user_message_count).toBe(1)
    expect(meta.tool_counts.edit).toBe(1)
    expect(meta.tool_counts.bash).toBe(1)
    expect(meta.languages.TypeScript).toBe(1)
    expect(meta.first_user_prompt).toBe("hello")
  })

  test("counts apply_patch lines added/removed and files modified", () => {
    // OpenCode's apply_patch envelope (see src/tool/apply_patch.ts):
    //   *** Begin Patch / *** Update File: <path> / @@ / +-/ context / *** End Patch
    // — NOT unified diff. The parser ignores `*** ` control lines and `@@`
    // anchors, leaving + / - / context to count.
    const patchText = [
      "*** Begin Patch",
      "*** Update File: src/foo.ts",
      "@@",
      " context line",
      "-removed line",
      "+added line one",
      "+added line two",
      "*** End Patch",
    ].join("\n")
    const meta = extractSessionMeta(fixtureSession("s1", 0, 60_000), [
      {
        info: {
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-opus-4-7",
          agent: "build",
          time: { created: 1_000 },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        },
        parts: [
          {
            type: "tool",
            tool: "apply_patch",
            state: { status: "completed", input: { patchText } },
          },
        ],
      } as any,
    ])
    expect(meta.lines_added).toBe(2)
    expect(meta.lines_removed).toBe(1)
    expect(meta.files_modified).toBe(1)
    expect(meta.tool_counts.apply_patch).toBe(1)
  })

  test("apply_patch counts Add File / Delete File targets", () => {
    const patchText = [
      "*** Begin Patch",
      "*** Add File: docs/new.md",
      "+# New",
      "+content",
      "*** Delete File: tmp/old.md",
      "*** End Patch",
    ].join("\n")
    const meta = extractSessionMeta(fixtureSession("s1", 0, 60_000), [
      {
        info: {
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-opus-4-7",
          agent: "build",
          time: { created: 1_000 },
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0,
        },
        parts: [
          {
            type: "tool",
            tool: "apply_patch",
            state: { status: "completed", input: { patchText } },
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ])
    expect(meta.files_modified).toBe(2)
    expect(meta.lines_added).toBe(2)
  })
})

describe("aggregate", () => {
  test("totals fold across sessions", () => {
    const m1 = extractSessionMeta(fixtureSession("s1", 0, 60_000), [])
    const m2 = extractSessionMeta(fixtureSession("s2", 60_000, 120_000), [])
    const agg = aggregate([m1, m2], new Map())
    expect(agg.total_sessions).toBe(2)
    expect(agg.sessions_with_facets).toBe(0)
  })
})
