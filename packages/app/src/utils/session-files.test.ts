import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { sessionTouchedFiles } from "./session-files"

function message(id: string, summary?: unknown, role: Message["role"] = "user"): Message {
  return {
    id,
    role,
    sessionID: "session-1",
    time: { created: 0 },
    version: 1,
    info: {},
    ...(summary === undefined ? {} : { summary }),
  } as unknown as Message
}

describe("sessionTouchedFiles", () => {
  test("collects files from user message diff summaries", () => {
    const messages = [
      message("m1", {
        diffs: [
          { file: "src/a.ts", patch: "", additions: 1, deletions: 0, status: "modified" },
          { file: "src/b.ts", patch: "", additions: 1, deletions: 0, status: "added" },
        ],
      }),
      message("m2", {
        diffs: [{ file: "src/c.ts", patch: "", additions: 1, deletions: 0, status: "modified" }],
      }),
    ]
    expect([...sessionTouchedFiles(messages)].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"])
  })

  test("skips assistant messages", () => {
    const messages = [
      message(
        "m1",
        { diffs: [{ file: "src/a.ts", patch: "", additions: 1, deletions: 0 }] },
        "assistant",
      ),
    ]
    expect(sessionTouchedFiles(messages).size).toBe(0)
  })

  test("deduplicates files across turns", () => {
    const diff = { file: "src/a.ts", patch: "", additions: 1, deletions: 0, status: "modified" as const }
    const messages = [message("m1", { diffs: [diff] }), message("m2", { diffs: [diff] })]
    expect([...sessionTouchedFiles(messages)]).toEqual(["src/a.ts"])
  })

  test("returns empty set for messages without summaries", () => {
    const messages = [message("m1"), message("m2")]
    expect(sessionTouchedFiles(messages).size).toBe(0)
  })

  test("tolerates malformed diff payloads", () => {
    const messages = [
      message("m1", {
        diffs: [
          { file: "src/ok.ts", patch: "p", additions: 1, deletions: 0 },
          "garbage",
          null,
          { patch: "missing file field" },
        ],
      }),
    ]
    expect([...sessionTouchedFiles(messages)]).toEqual(["src/ok.ts"])
  })
})
