import { describe, expect, test } from "bun:test"
import type { AnyRequest, CreateElicitationResponse } from "@agentclientprotocol/sdk"
import { ACPElicitation } from "../../src/acp/elicitation"
import {
  childCreated,
  delivered,
  durableEvent,
  ephemeralEvent,
  interrupted,
  startSession,
  succeeded,
  textDelta,
  toolStarted,
  toolSucceeded,
} from "./wire-fixture"

const questions = (sessionID: string, id = "frm_question", tool = "call_question") =>
  ephemeralEvent("form.created", {
    form: {
      id,
      sessionID,
      title: "Questions",
      metadata: { kind: "question", tool: { messageID: "msg_tools", id: tool } },
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

const form = (fields: ACPElicitation.Form["fields"], metadata?: ACPElicitation.Form["metadata"]) => ({
  id: "frm_test",
  sessionID: "ses_test",
  title: "Test",
  ...(metadata ? { metadata } : {}),
  fields,
})

const accept = (content: Record<string, string | number | boolean | string[]>): CreateElicitationResponse => ({
  action: "accept",
  content,
})

describe("acp elicitation mapping", () => {
  test("maps every representable field type", () => {
    expect(
      ACPElicitation.requestedSchema(
        form([
          {
            key: "email",
            title: "Email",
            description: "Work address",
            type: "string",
            format: "email",
            maxLength: 80,
            pattern: ".+@.+",
            placeholder: "you@example.com",
            default: "a@b.co",
            required: true,
          },
          { key: "name", type: "string", minLength: 2 },
          {
            key: "plan",
            type: "string",
            options: [
              { value: "pro", label: "Pro", description: "Paid" },
              { value: "free", label: "Free" },
            ],
            default: "free",
          },
          { key: "ratio", type: "number", minimum: 0, maximum: 1, default: 0.5 },
          { key: "count", type: "integer", minimum: 1, required: true },
          { key: "confirm", type: "boolean", default: false },
          {
            key: "tags",
            type: "multiselect",
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
            maxItems: 2,
            default: ["a"],
            required: true,
          },
          { key: "server", type: "string", format: "uri", hidden: true, default: "https://example.com" },
        ]),
      ),
    ).toEqual({
      type: "object",
      properties: {
        email: {
          type: "string",
          title: "Email",
          description: "Work address",
          format: "email",
          minLength: 1,
          maxLength: 80,
          pattern: ".+@.+",
          default: "a@b.co",
        },
        name: { type: "string", minLength: 2 },
        plan: {
          type: "string",
          oneOf: [
            { const: "pro", title: "Pro", description: "Paid" },
            { const: "free", title: "Free" },
          ],
          default: "free",
        },
        ratio: { type: "number", minimum: 0, maximum: 1, default: 0.5 },
        count: { type: "integer", minimum: 1 },
        confirm: { type: "boolean", default: false },
        tags: {
          type: "array",
          items: {
            anyOf: [
              { const: "a", title: "A" },
              { const: "b", title: "B" },
            ],
          },
          minItems: 1,
          maxItems: 2,
          default: ["a"],
        },
      },
      required: ["email", "count", "tags"],
    })
  })

  test("adds a free-text property next to options that accept a custom answer", () => {
    expect(
      ACPElicitation.requestedSchema(
        form([
          {
            key: "q0",
            title: "Runtime",
            type: "string",
            options: [{ value: "Bun", label: "Bun" }],
            custom: true,
            maxLength: 20,
          },
          { key: "q1", type: "multiselect", options: [{ value: "Fast", label: "Fast" }], custom: true },
        ]),
      )?.properties,
    ).toEqual({
      q0: { type: "string", title: "Runtime", oneOf: [{ const: "Bun", title: "Bun" }] },
      q0_custom: { type: "string", title: "Runtime (other)", description: "Type your own answer", maxLength: 20 },
      q1: { type: "array", items: { anyOf: [{ const: "Fast", title: "Fast" }] } },
      q1_custom: { type: "string", title: "q1 (other)", description: "Add your own answer" },
    })
  })

  test("refuses forms it cannot represent faithfully", () => {
    const options = [{ value: "a", label: "A" }]
    const unrepresentable: Array<ACPElicitation.Form["fields"]> = [
      [
        { key: "mode", type: "boolean" },
        { key: "detail", type: "string", when: [{ key: "mode", op: "eq", value: true }] },
      ],
      [{ key: "login", type: "external", url: "https://example.com/login" }],
      [{ key: "pick", type: "string", options, custom: true, required: true }],
      [{ key: "pick", type: "multiselect", options, custom: true, maxItems: 1 }],
      [{ key: "pick", type: "string", options, default: "b" }],
      [{ key: "pick", type: "multiselect", options, default: ["a", "b"] }],
      [
        { key: "pick", type: "string", options, custom: true },
        { key: "pick_custom", type: "string" },
      ],
    ]
    expect(unrepresentable.map((fields) => ACPElicitation.requestedSchema(form(fields)))).toEqual(
      unrepresentable.map(() => undefined),
    )
  })

  test("maps an accepted response back to answers", () => {
    const options = [{ value: "a", label: "A" }]
    const fields: ACPElicitation.Form["fields"] = [
      { key: "single", type: "string", options, custom: true },
      { key: "multi", type: "multiselect", options, custom: true },
      { key: "blank", type: "string", options, custom: true },
      { key: "count", type: "integer" },
      { key: "server", type: "string", hidden: true, default: "https://example.com" },
      { key: "token", type: "string", hidden: true },
    ]
    expect(
      ACPElicitation.answer(
        form(fields),
        accept({
          single: "a",
          single_custom: "typed",
          multi: ["a"],
          multi_custom: "extra",
          blank: "a",
          blank_custom: "  ",
          count: 3,
          server: "https://other.example.com",
          unknown: true,
        }),
      ),
    ).toEqual({
      single: "typed",
      multi: ["a", "extra"],
      blank: "a",
      count: 3,
      server: "https://example.com",
    })
    expect(ACPElicitation.answer(form(fields), accept({ multi_custom: "only" }))).toEqual({
      multi: ["only"],
      server: "https://example.com",
    })
    expect(ACPElicitation.answer(form(fields), { action: "accept" })).toEqual({ server: "https://example.com" })
  })

  test("has no answer unless the user accepted valid content", () => {
    const fields: ACPElicitation.Form["fields"] = [{ key: "name", type: "string" }]
    expect(ACPElicitation.answer(form(fields), { action: "decline" })).toBeUndefined()
    expect(ACPElicitation.answer(form(fields), { action: "cancel" })).toBeUndefined()
    expect(ACPElicitation.answer(form(fields), { action: "_custom" })).toBeUndefined()
  })

  test("reads the asking tool call from form metadata", () => {
    const fields: ACPElicitation.Form["fields"] = [{ key: "name", type: "string" }]
    expect(ACPElicitation.toolCallID(form(fields, { tool: { messageID: "msg", id: "call_1" } }))).toBe("call_1")
    expect(ACPElicitation.toolCallID(form(fields, { tool: "call_1" }))).toBeUndefined()
    expect(ACPElicitation.toolCallID(form(fields))).toBeUndefined()
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
    expect(acp.elicitations).toEqual([
      {
        mode: "form",
        sessionId: acp.sessionId,
        toolCallId: "call_question",
        message: "Questions",
        requestedSchema: {
          type: "object",
          properties: {
            q0: {
              type: "string",
              title: "Runtime",
              description: "Which runtime?",
              oneOf: [
                { const: "Bun", title: "Bun", description: "Fast" },
                { const: "Node", title: "Node", description: "Stable" },
              ],
            },
            q0_custom: { type: "string", title: "Runtime (other)", description: "Type your own answer" },
            q1: {
              type: "array",
              title: "Goals",
              description: "What matters?",
              items: { anyOf: [{ const: "Fast", title: "Fast", description: "Speed" }] },
            },
            q1_custom: { type: "string", title: "Goals (other)", description: "Add your own answer" },
          },
          required: [],
        },
      },
    ])
    expect(acp.server.repliedForms).toEqual([
      { sessionID: acp.sessionId, formID: "frm_question", answer: { q0: "Bun", q1: ["Fast", "Small"] } },
    ])
    expect(acp.server.cancelledForms).toEqual([])
    expect(acp.updates.some((item) => item.update.sessionUpdate === "agent_message_chunk")).toBe(true)
  })

  test("cancels the form when the client declines, cancels, or fails", async () => {
    const responses: Array<() => CreateElicitationResponse> = [
      () => ({ action: "decline" }),
      () => ({ action: "cancel" }),
      () => {
        throw new Error("elicitation UI failed")
      },
    ]
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        questions(sessionID, "frm_decline"),
        questions(sessionID, "frm_cancel"),
        questions(sessionID, "frm_fail"),
      ],
      elicitation: () => responses[acp.elicitations.length - 1](),
      onFormCancel: ({ sessionID }) => (acp.server.cancelledForms.length === 3 ? [succeeded(sessionID)] : []),
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toHaveLength(3)
    expect(acp.server.cancelledForms.map((item) => item.formID)).toEqual(["frm_decline", "frm_cancel", "frm_fail"])
    expect(acp.server.repliedForms).toEqual([])
    expect(acp.server.interrupts).toEqual([])
  })

  test("auto-cancels forms when the client does not support form elicitation", async () => {
    await using acp = await startSession({
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), questions(sessionID)],
      onFormCancel: ({ sessionID }) => [succeeded(sessionID)],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toEqual([])
    expect(acp.server.cancelledForms).toEqual([{ sessionID: acp.sessionId, formID: "frm_question" }])
  })

  test("auto-cancels forms that elicitation cannot represent", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        ephemeralEvent("form.created", {
          form: {
            id: "frm_conditional",
            sessionID,
            title: "Setup",
            fields: [
              { key: "custom", type: "boolean" },
              { key: "path", type: "string", when: [{ key: "custom", op: "eq", value: true }] },
            ],
          },
        }),
      ],
      onFormCancel: ({ sessionID }) => [succeeded(sessionID)],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toEqual([])
    expect(acp.server.cancelledForms).toEqual([{ sessionID: acp.sessionId, formID: "frm_conditional" }])
  })

  test("cancelling the turn cancels its pending elicitation and the form", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), questions(sessionID)],
      onInterrupt: ({ sessionID }) => [interrupted(sessionID)],
      elicitation: (_request, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ action: "cancel" }), { once: true })
        }),
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.elicitations.length === 1, "elicitation request")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    await acp.until(() => acp.server.cancelledForms.length === 1, "form cancellation")
    expect(acp.server.cancelledForms).toEqual([{ sessionID: acp.sessionId, formID: "frm_question" }])
    expect(acp.server.repliedForms).toEqual([])
    const asked = acp.received.find(
      (message): message is AnyRequest =>
        "method" in message && "id" in message && message.method === "elicitation/create",
    )
    expect(acp.received).toContainEqual({
      jsonrpc: "2.0",
      method: "$/cancel_request",
      params: { requestId: asked?.id },
    })
  })

  test("prefixes a child session form's tool call and message with the child", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        childCreated("ses_child", sessionID, "Review code"),
        durableEvent("session.execution.started", { sessionID: "ses_child" }),
        questions("ses_child", "frm_child", "call_child"),
      ],
      elicitation: () => accept({ q0: "Node" }),
      onFormReply: ({ sessionID }) => [succeeded(sessionID), succeeded(acp.sessionId)],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toMatchObject([
      { sessionId: acp.sessionId, toolCallId: "ses_child:call_child", message: "Review code: Questions" },
    ])
    expect(acp.server.repliedForms).toEqual([{ sessionID: "ses_child", formID: "frm_child", answer: { q0: "Node" } }])
  })
})
