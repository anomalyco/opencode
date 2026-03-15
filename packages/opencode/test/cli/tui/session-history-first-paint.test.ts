import { describe, expect, test } from "bun:test"
import {
  buildInitialHistoryState,
  mergeFullHistoryState,
} from "../../../src/cli/cmd/tui/context/session-history"

describe("session history first paint", () => {
  test("shows preview state before full history is ready", () => {
    const initial = buildInitialHistoryState({
      sessionID: "ses_1",
      messages: [
        {
          info: { id: "msg_2", role: "assistant", sessionID: "ses_1" },
          parts: [
            {
              id: "prt_1",
              type: "text",
              text: "Latest assistant text",
              sessionID: "ses_1",
              messageID: "msg_2",
            },
          ],
        },
      ],
    })

    expect(initial.ready).toBe(false)
    expect(initial.previewText).toBe("Latest assistant text")
    expect(initial.messages).toHaveLength(1)
  })

  test("marks history ready after full hydrate and preserves previewable text", () => {
    const initial = buildInitialHistoryState({
      sessionID: "ses_1",
      messages: [
        {
          info: { id: "msg_2", role: "assistant", sessionID: "ses_1" },
          parts: [
            {
              id: "prt_1",
              type: "text",
              text: "Latest assistant text",
              sessionID: "ses_1",
              messageID: "msg_2",
            },
          ],
        },
      ],
    })

    const full = mergeFullHistoryState(initial, [
      {
        info: { id: "msg_1", role: "user", sessionID: "ses_1" },
        parts: [
          {
            id: "prt_2",
            type: "text",
            text: "Original user prompt",
            sessionID: "ses_1",
            messageID: "msg_1",
          },
        ],
      },
      {
        info: { id: "msg_2", role: "assistant", sessionID: "ses_1" },
        parts: [
          {
            id: "prt_1",
            type: "text",
            text: "Latest assistant text",
            sessionID: "ses_1",
            messageID: "msg_2",
          },
        ],
      },
    ])

    expect(full.ready).toBe(true)
    expect(full.previewText).toBe("Latest assistant text")
    expect(full.messages.map((x) => x.info.id)).toEqual(["msg_1", "msg_2"])
  })
})
