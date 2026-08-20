import { describe, expect, test } from "bun:test"
import { readShareDocument } from "../../src/core/share-document"
import { Share } from "../../src/core/share"

describe("share document", () => {
  test("rejects malformed current message batches", () => {
    expect(() => Share.Messages.parse({ sessionID: "ses_current", messages: [null] })).toThrow()
  })

  test("passes current blobs through", async () => {
    const data = Share.Data.array().parse([
      {
        type: "session",
        data: {
          id: "ses_current",
          projectID: "project_current",
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          title: "Current share",
          location: { directory: "/workspace" },
          time: { created: 1, updated: 2 },
        },
      },
      {
        type: "messages",
        data: {
          sessionID: "ses_current",
          messages: [{ id: "msg_current", type: "user", text: "Current prompt", time: { created: 1 } }],
        },
      },
    ])

    const result = await readShareDocument(data)

    expect(result.session.id).toBe("ses_current")
    expect(result.messages).toEqual([{ id: "msg_current", type: "user", text: "Current prompt", time: { created: 1 } }])
  })

  test("maps a legacy Session without changing its blob", async () => {
    const sessionID = "ses_stored"
    const messageID = "msg_000000000001aaaaaaaaaaaaaa"
    const assistantID = "msg_000000000002aaaaaaaaaaaaaa"
    const data = Share.Data.array().parse([
      {
        type: "session",
        data: {
          id: sessionID,
          projectID: "project_stored",
          directory: "/workspace",
          title: "Stored share",
          version: "1",
          time: { created: 1, updated: 2 },
        },
      },
      {
        type: "message",
        data: {
          id: messageID,
          sessionID,
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: { providerID: "provider", modelID: "model" },
        },
      },
      {
        type: "part",
        data: {
          id: "prt_000000000001aaaaaaaaaaaaaa",
          sessionID,
          messageID,
          type: "text",
          text: "Stored prompt",
        },
      },
      {
        type: "part",
        data: {
          id: "prt_000000000004aaaaaaaaaaaaaa",
          sessionID,
          messageID,
          type: "text",
          text: "Visible ignored text",
          ignored: true,
        },
      },
      {
        type: "part",
        data: {
          id: "prt_000000000005aaaaaaaaaaaaaa",
          sessionID,
          messageID,
          type: "text",
          text: "Internal synthetic text",
          synthetic: true,
        },
      },
      {
        type: "message",
        data: {
          id: assistantID,
          sessionID,
          role: "assistant",
          time: { created: 2, completed: 4 },
          parentID: messageID,
          modelID: "model",
          providerID: "provider",
          mode: "build",
          path: { cwd: "/workspace", root: "/workspace" },
          cost: 0.25,
          tokens: { input: 3, output: 5, reasoning: 1, cache: { read: 2, write: 0 } },
          finish: "stop",
        },
      },
      {
        type: "part",
        data: {
          id: "prt_000000000002aaaaaaaaaaaaaa",
          sessionID,
          messageID: assistantID,
          type: "text",
          text: "Stored response",
        },
      },
      {
        type: "part",
        data: {
          id: "prt_000000000003aaaaaaaaaaaaaa",
          sessionID,
          messageID: assistantID,
          type: "tool",
          callID: "call_read",
          tool: "read",
          state: {
            status: "completed",
            input: { path: "README.md" },
            output: "hello",
            title: "Read README.md",
            metadata: {},
            time: { start: 2, end: 3 },
          },
        },
      },
    ])
    const snapshot = structuredClone(data)

    const result = await readShareDocument(data)

    expect(data).toEqual(snapshot)
    expect(result.session).toMatchObject({ id: sessionID, location: { directory: "/workspace" } })
    expect(result.session).toMatchObject({ model: { id: "model", providerID: "provider" }, cost: 0 })
    expect(result.messages).toEqual([
      {
        id: messageID,
        type: "user",
        text: "Stored prompt\n\nVisible ignored text",
        metadata: { agent: "build", model: { id: "model", providerID: "provider" } },
        time: { created: 1 },
      },
      {
        id: assistantID,
        type: "assistant",
        agent: "build",
        model: { id: "model", providerID: "provider" },
        content: [
          { type: "text", text: "Stored response" },
          {
            type: "tool",
            id: "call_read",
            name: "read",
            state: { status: "completed", input: { path: "README.md" }, content: [{ type: "text", text: "hello" }] },
            time: { created: 2 },
          },
        ],
        time: { created: 2, completed: 4 },
      },
    ])
  })
})
