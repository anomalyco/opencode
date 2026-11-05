import { describe, expect, test } from "bun:test"
import type { CreateElicitationResponse } from "@agentclientprotocol/sdk"
import { ACPElicitation } from "../../src/acp/elicitation"
import {
  delivered,
  ephemeralEvent,
  startSession,
  succeeded,
  textDelta,
  toolStarted,
  toolSucceeded,
} from "./wire-fixture"

const questions = (sessionID: string, id = "frm_question") =>
  ephemeralEvent("form.created", {
    form: {
      id,
      sessionID,
      title: "Questions",
      metadata: { kind: "question", tool: { messageID: "msg_tools", id: "call_question" } },
      fields: [
        {
          key: "q0",
          title: "Runtime",
          description: "Which runtime?",
          type: "string",
          options: [
            { value: "Bun", label: "Bun", description: "Fast" },
            { value: "Node", label: "Node", description: "Stable" },
          ],
          custom: true,
        },
        {
          key: "q1",
          title: "Goals",
          description: "What matters?",
          type: "multiselect",
          options: [{ value: "Fast", label: "Fast", description: "Speed" }],
          custom: true,
        },
      ],
    },
  })

const capable = { childSessionUpdates: false, formElicitation: true, compaction: false }

const form = (
  fields: ACPElicitation.AskedForm["fields"],
  metadata: ACPElicitation.AskedForm["metadata"] = { kind: "question" },
) => ({ id: "frm_test", sessionID: "ses_test", title: "Test", metadata, fields })

const accept = (content: Record<string, string | number | boolean | string[]>): CreateElicitationResponse => ({
  action: "accept",
  content,
})

describe("acp elicitation mapping", () => {
  test("cancels forms from unsupported clients, unknown flows, and credential-looking fields", () => {
    const fields: ACPElicitation.AskedForm["fields"] = [{ key: "name", type: "string" }]
    expect(ACPElicitation.requestedSchema(form(fields), { ...capable, formElicitation: false })).toBeUndefined()
    expect(ACPElicitation.requestedSchema(form(fields, { kind: "mcp-elicitation" }), capable)).toBeUndefined()
    expect(ACPElicitation.requestedSchema(form(fields, {}), capable)).toBeUndefined()
    expect(ACPElicitation.requestedSchema(form(fields, { kind: "websearch.provider" }), capable)).toBeDefined()
    const credentials: Array<ACPElicitation.AskedForm["fields"]> = [
      [{ key: "api_key", type: "string" }],
      [{ key: "q0", title: "GitHub token", type: "string" }],
      [{ key: "q0", title: "Password", type: "string", hidden: true, default: "" }],
      [{ key: "q0", title: "Setup", description: "Paste your API key", type: "string" }],
      [{ key: "q0", title: "Token", type: "string", options: [], custom: true }],
    ]
    expect(credentials.map((fields) => ACPElicitation.requestedSchema(form(fields), capable))).toEqual(
      credentials.map(() => undefined),
    )
  })

  test("sends choices that mention secrets without a typed answer", () => {
    expect(
      ACPElicitation.requestedSchema(
        form([
          {
            key: "q0",
            title: "Token",
            description: "Which API token should I use?",
            type: "string",
            options: [
              { value: "Alpha", label: "Alpha" },
              { value: "Beta", label: "Beta" },
            ],
            custom: true,
            required: true,
          },
          {
            key: "q1",
            title: "Logging",
            description: "Which fields may carry secrets?",
            type: "multiselect",
            options: [{ value: "Headers", label: "Headers with access tokens" }],
            custom: true,
          },
          { key: "q2", title: "Do you have an API key?", type: "boolean" },
          { key: "q3", title: "Token budget", type: "integer" },
        ]),
        capable,
      ),
    ).toEqual({
      type: "object",
      properties: {
        q0: {
          type: "string",
          title: "Token",
          description: "Which API token should I use?",
          oneOf: [
            { const: "Alpha", title: "Alpha", description: undefined },
            { const: "Beta", title: "Beta", description: undefined },
          ],
          default: undefined,
        },
        q1: {
          type: "array",
          title: "Logging",
          description: "Which fields may carry secrets?",
          items: { anyOf: [{ const: "Headers", title: "Headers with access tokens", description: undefined }] },
          minItems: undefined,
          maxItems: undefined,
          default: undefined,
        },
        q2: { type: "boolean", title: "Do you have an API key?", description: undefined, default: undefined },
        q3: {
          type: "integer",
          title: "Token budget",
          description: undefined,
          minimum: undefined,
          maximum: undefined,
          default: undefined,
        },
      },
      required: ["q0"],
    })
  })
})

describe("acp elicitation over the wire", () => {
  test("answers a question form through elicitation and continues the turn", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        toolStarted(sessionID, "call_question", "question"),
        questions(sessionID),
      ],
      elicitation: () => accept({ q0: "Bun", q1: ["Fast"], q1_custom: "Small" }),
      onFormReply: ({ sessionID, formID }) => [
        ephemeralEvent("form.replied", { sessionID, id: formID, answer: {} }),
        toolSucceeded(sessionID, "call_question", {}, "answered"),
        textDelta(sessionID, "msg_after", "thanks"),
        succeeded(sessionID),
      ],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toMatchObject([
      { mode: "form", sessionId: acp.sessionId, toolCallId: "call_question", message: "Questions" },
    ])
    expect(acp.server.repliedForms).toEqual([
      { sessionID: acp.sessionId, formID: "frm_question", answer: { q0: "Bun", q1: ["Fast", "Small"] } },
    ])
    expect(acp.server.cancelledForms).toEqual([])
    expect(acp.updates.some((item) => item.update.sessionUpdate === "agent_message_chunk")).toBe(true)
  })

  test("cancels the form when the client declines, cancels, fails, or sends a wrong value type", async () => {
    const responses: Array<() => CreateElicitationResponse> = [
      () => ({ action: "decline" }),
      () => ({ action: "cancel" }),
      () => {
        throw new Error("elicitation UI failed")
      },
      () => ({ action: "accept", content: { q0: { nested: true } } }),
    ]
    const ids = ["frm_decline", "frm_cancel", "frm_fail", "frm_invalid"]
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), ...ids.map((form) => questions(sessionID, form))],
      elicitation: () => responses[acp.elicitations.length - 1](),
      onFormCancel: ({ sessionID }) => (acp.server.cancelledForms.length === ids.length ? [succeeded(sessionID)] : []),
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toHaveLength(ids.length)
    expect(acp.server.cancelledForms.map((item) => item.formID)).toEqual(ids)
    expect(acp.server.cancelledForms.map((item) => item.message)).toEqual(ids.map(() => undefined))
    expect(acp.server.repliedForms).toEqual([])
    expect(acp.server.interrupts).toEqual([])
  })

  test("tells the model why a question asking for a secret wasn't shown", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        ephemeralEvent("form.created", {
          form: {
            id: "frm_secret",
            sessionID,
            title: "Questions",
            metadata: { kind: "question" },
            fields: [{ key: "q0", title: "Setup", description: "Paste your API key", type: "string" }],
          },
        }),
      ],
      onFormCancel: ({ sessionID }) => [succeeded(sessionID)],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toEqual([])
    expect(acp.server.cancelledForms).toEqual([
      { sessionID: acp.sessionId, formID: "frm_secret", message: ACPElicitation.SecretQuestionMessage },
    ])
  })
})
