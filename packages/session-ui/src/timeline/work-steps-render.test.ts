import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { TimelineRow } from "./timeline-row"
import {
  workStepFinalReplyPartByTurn,
  workStepDetail,
  workStepFirstRowByTurn,
  workStepTurnsWithLaterInput,
  workStepTurnStatus,
} from "./work-steps-render"
import { workStepPolicy } from "./work-steps"

describe("work step rendering facts", () => {
  test("maps turn phases to work statuses", () => {
    expect(workStepTurnStatus({ status: "working" })).toBe("live")
    expect(
      workStepTurnStatus({
        status: "thinking",
        ref: { messageID: "message", partID: "thought" },
        placement: "grouped",
      }),
    ).toBe("live")
    expect(workStepTurnStatus({ status: "retrying", attempt: 1, message: "retry", next: 2 })).toBe("live")
    expect(workStepTurnStatus({ status: "failed", error: { text: "failed" } })).toBe("error")
    expect(workStepTurnStatus({ status: "interrupted" })).toBe("interrupted")
    expect(workStepTurnStatus({ status: "idle" })).toBe("completed")
  })

  test("finds the first work row independently for each turn", () => {
    const row = (userMessageID: string, partID: string) =>
      new TimelineRow.AssistantPart({
        userMessageID,
        previousAssistantPart: false,
        group: {
          type: "context",
          key: `work:${partID}`,
          refs: [{ messageID: partID, partID }],
          work: { responseID: partID },
        },
      })

    const rows = [row("turn-1", "a"), row("turn-1", "b"), row("turn-2", "c")]

    expect(workStepFirstRowByTurn(rows)).toEqual(
      new Map([
        ["turn-1", "assistant-part:context:work:a"],
        ["turn-2", "assistant-part:context:work:c"],
      ]),
    )
  })

  test("finds the final reply and later input without reading stored history", () => {
    const messages: SessionMessageInfo[] = [
      { id: "turn-1", type: "user", text: "go", time: { created: 0 } },
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "Intermediate" }],
        time: { created: 1, completed: 2 },
      },
      {
        id: "a2",
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [{ type: "text", text: "Final" }],
        time: { created: 3, completed: 4 },
      },
      { id: "turn-2", type: "user", text: "next", time: { created: 5 } },
    ]

    expect(workStepFinalReplyPartByTurn(messages)).toEqual(new Map([["turn-1", "a2:text:0"]]))
    expect(workStepTurnsWithLaterInput(messages)).toEqual(new Set(["turn-1"]))
    expect(
      workStepTurnsWithLaterInput([
        ...messages,
        { id: "turn-3", type: "user", text: "last", time: { created: 6 } },
        {
          id: "shell",
          type: "shell",
          command: "ls",
          shellID: "shell",
          status: "exited",
          exit: 0,
          time: { created: 7 },
        },
      ]),
    ).toEqual(new Set(["turn-1", "turn-2"]))
  })

  test("shows live tool detail only in standard and reasoning preview after settlement only in standard", () => {
    const tool = {
      id: "read",
      type: "tool" as const,
      name: "read",
      state: { status: "running" as const, input: { path: "src/timeline.ts" }, metadata: {} },
      time: { created: 0 },
    }

    const reasoning = {
      id: "thought",
      type: "reasoning" as const,
      text: "## Timeline audit\n\nChecking the grouping policy.",
      time: { created: 0, completed: 1 },
    }

    const standard = workStepPolicy({ view: "standard", collapseTiming: "completion", foldedReplies: "all" })
    const compact = workStepPolicy({ view: "compact", collapseTiming: "completion", foldedReplies: "all" })

    expect(workStepDetail([tool], true, standard)).toBe("src/timeline.ts")
    expect(workStepDetail([tool], true, compact)).toBeUndefined()
    expect(workStepDetail([reasoning], false, standard)).toBe("Timeline audit")
    expect(workStepDetail([reasoning], false, compact)).toBeUndefined()
    expect(workStepDetail([{ ...reasoning, time: { created: 0 }, streaming: true }], true, compact)).toBe(
      "Timeline audit",
    )
  })
})
