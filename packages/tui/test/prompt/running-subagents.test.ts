import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import { runningSubagents } from "../../src/component/prompt/running-subagents"

function session(id: string, parentID: string | undefined, title: string, created: number) {
  return { id, parentID, title, time: { created, updated: created } } as Session
}

const sessions = [
  session("ses_parent", undefined, "main", 0),
  session("ses_b", "ses_parent", "Check the weather API (@general subagent)", 2),
  session("ses_a", "ses_parent", "Count slowly to twenty (@general subagent)", 1),
  session("ses_done", "ses_parent", "Finished one (@explore subagent)", 3),
  session("ses_other", "ses_elsewhere", "Another parent's child (@general subagent)", 4),
  session("ses_grandchild", "ses_a", "Nested (@general subagent)", 5),
]

describe("runningSubagents", () => {
  test("lists busy and retrying children of the session, oldest first, without the agent suffix", () => {
    expect(
      runningSubagents(
        sessions,
        {
          ses_a: { type: "busy" },
          ses_b: { type: "retry", attempt: 1, message: "", next: 0 },
          ses_other: { type: "busy" },
          ses_grandchild: { type: "busy" },
        },
        "ses_parent",
      ),
    ).toEqual([
      { id: "ses_a", title: "Count slowly to twenty" },
      { id: "ses_b", title: "Check the weather API" },
    ])
  })

  test("drops children that are idle or have no status", () => {
    expect(runningSubagents(sessions, { ses_done: { type: "idle" } }, "ses_parent")).toEqual([])
  })
})
