import { describe, expect, test } from "bun:test"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import { OpenCode } from "@opencode-ai/client/promise"
import { replyQuestion } from "../../src/acp/question"
import { ephemeralEvent } from "./sse-fixture"

describe("ACP question elicitation", () => {
  test("replies with accepted single, multiple, and custom answers", async () => {
    const bodies: unknown[] = []
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        bodies.push(await request.json())
        return new Response(null, { status: 204 })
      },
    })
    const requests: Array<{ method: string; params: Record<string, unknown> }> = []
    const connection = {
      extMethod: async (method, params) => {
        requests.push({ method, params })
        return {
          action: {
            action: "accept",
            content: { q0: "CustomTests", q1: ["Hydra", "Load"] },
          },
        }
      },
    } satisfies Partial<Pick<AgentSideConnection, "extMethod">>

    try {
      await replyQuestion({
        client: OpenCode.make({ baseUrl: server.url.toString() }),
        connection,
        event: questionEvent("que_1"),
        clientSessionID: "ses_parent",
        supported: true,
      })

      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        method: "session/elicitation",
        params: {
          mode: "form",
          sessionId: "ses_parent",
          requestedSchema: {
            required: ["q0", "q1"],
            properties: {
              q0: { type: "string", title: "Package" },
              q1: { type: "array", title: "Suites" },
            },
          },
        },
      })
      expect(bodies).toEqual([{ answer: { q0: "CustomTests", q1: ["Hydra", "Load"] } }])
    } finally {
      await server.stop(true)
    }
  })

  test("rejects when elicitation is declined or unsupported", async () => {
    const paths: string[] = []
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        paths.push(new URL(request.url).pathname)
        return new Response(null, { status: 204 })
      },
    })
    const client = OpenCode.make({ baseUrl: server.url.toString() })
    const connection = {
      extMethod: async () => ({ action: { action: "decline" } }),
    } satisfies Partial<Pick<AgentSideConnection, "extMethod">>

    try {
      await replyQuestion({
        client,
        connection,
        event: questionEvent("que_declined"),
        clientSessionID: "ses_parent",
        supported: true,
      })
      await replyQuestion({
        client,
        connection,
        event: questionEvent("que_unsupported"),
        clientSessionID: "ses_parent",
        supported: false,
      })

      expect(paths).toEqual([
        "/api/session/ses_question/form/frm_declined/cancel",
        "/api/session/ses_question/form/frm_unsupported/cancel",
      ])
    } finally {
      await server.stop(true)
    }
  })
})

function questionEvent(id: string) {
  return ephemeralEvent("form.created", {
    form: {
      id: id.replace("que_", "frm_"),
      sessionID: "ses_question",
      title: "Questions",
      metadata: { kind: "question" },
      fields: [
        {
          key: "q0",
          type: "string",
          title: "Package",
          description: "Which package?",
          options: [{ value: "DefaultTests", label: "DefaultTests", description: "Use the default package" }],
        },
        {
          key: "q1",
          type: "multiselect",
          title: "Suites",
          description: "Which suites?",
          options: [
            { value: "Hydra", label: "Hydra", description: "Run Hydra" },
            { value: "Load", label: "Load", description: "Run load tests" },
          ],
        },
      ],
    },
  })
}
