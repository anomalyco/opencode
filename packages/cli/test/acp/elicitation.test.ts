import { describe, expect, test } from "bun:test"
import type { AnyMessage, AnyRequest, CreateElicitationResponse } from "@agentclientprotocol/sdk"
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

const capable = { childSessionUpdates: false, formElicitation: true, compaction: false }

const form = (
  fields: ACPElicitation.AskedForm["fields"],
  metadata: ACPElicitation.AskedForm["metadata"] = { kind: "question" },
) => ({ id: "frm_test", sessionID: "ses_test", title: "Test", metadata, fields })

const accept = (content: Record<string, string | number | boolean | string[]>): CreateElicitationResponse => ({
  action: "accept",
  content,
})

const pendingUntilAborted = (_request: unknown, signal: AbortSignal) =>
  new Promise<CreateElicitationResponse>((resolve) => {
    signal.addEventListener("abort", () => resolve({ action: "cancel" }), { once: true })
  })

const firstElicitationCancel = (received: readonly AnyMessage[]): AnyMessage => {
  const asked = received.find(
    (message): message is AnyRequest =>
      "method" in message && "id" in message && message.method === "elicitation/create",
  )
  return { jsonrpc: "2.0", method: "$/cancel_request", params: { requestId: asked?.id } }
}

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
        capable,
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
        capable,
      )?.properties,
    ).toEqual({
      q0: { type: "string", title: "Runtime", oneOf: [{ const: "Bun", title: "Bun" }] },
      q0_custom: { type: "string", title: "Runtime (other)", description: "Type your own answer", maxLength: 20 },
      q1: { type: "array", items: { anyOf: [{ const: "Fast", title: "Fast" }] } },
      q1_custom: { type: "string", title: "q1 (other)", description: "Add your own answer" },
    })
  })

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
    ]
    expect(credentials.map((fields) => ACPElicitation.requestedSchema(form(fields), capable))).toEqual(
      credentials.map(() => undefined),
    )
  })

  test("cancels forms it cannot represent faithfully", () => {
    const options = [{ value: "a", label: "A" }]
    const unrepresentable: Array<ACPElicitation.AskedForm["fields"]> = [
      [
        { key: "mode", type: "boolean" },
        { key: "detail", type: "string", when: [{ key: "mode", op: "eq", value: true }] },
      ],
      [
        { key: "mode", type: "boolean" },
        { key: "detail", type: "string", hidden: true, default: "x", when: [{ key: "mode", op: "eq", value: true }] },
      ],
      [{ key: "login", type: "external", url: "https://example.com/login" }],
      [{ key: "server", type: "string", hidden: true, required: true }],
      [{ key: "pick", type: "string", options, custom: true, required: true }],
      [{ key: "pick", type: "multiselect", options, custom: true, maxItems: 1 }],
      [{ key: "pick", type: "string", options, default: "b" }],
      [{ key: "pick", type: "multiselect", options, default: ["a", "b"] }],
      [
        { key: "pick", type: "string", options, custom: true },
        { key: "pick_custom", type: "string" },
      ],
    ]
    expect(unrepresentable.map((fields) => ACPElicitation.requestedSchema(form(fields), capable))).toEqual(
      unrepresentable.map(() => undefined),
    )
    expect(
      ACPElicitation.requestedSchema(
        form([
          { key: "name", type: "string" },
          { key: "pick", type: "string", options, default: "b", hidden: true },
        ]),
        capable,
      )?.properties,
    ).toEqual({ name: { type: "string" } })
  })

  test("maps an accepted response back to answers", () => {
    const options = [{ value: "a", label: "A" }]
    const fields: ACPElicitation.AskedForm["fields"] = [
      { key: "single", type: "string", options, custom: true },
      { key: "multi", type: "multiselect", options, custom: true },
      { key: "blank", type: "string", options, custom: true },
      { key: "count", type: "integer" },
      { key: "server", type: "string", hidden: true, default: "https://example.com" },
      { key: "region", type: "string", hidden: true },
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
    const fields: ACPElicitation.AskedForm["fields"] = [{ key: "name", type: "string" }]
    expect(ACPElicitation.answer(form(fields), { action: "decline" })).toBeUndefined()
    expect(ACPElicitation.answer(form(fields), { action: "cancel" })).toBeUndefined()
    expect(ACPElicitation.answer(form(fields), { action: "_custom" })).toBeUndefined()
    expect(
      ACPElicitation.answer(form(fields), { action: "accept", content: { name: { nested: true } } }),
    ).toBeUndefined()
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
    expect(acp.server.repliedForms).toEqual([])
    expect(acp.server.interrupts).toEqual([])
  })

  test("cancels forms outside the allowed flows without asking", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        ephemeralEvent("form.created", {
          form: {
            id: "frm_plugin",
            sessionID,
            title: "Plugin",
            metadata: { kind: "plugin" },
            fields: [{ key: "name", type: "string" }],
          },
        }),
      ],
      onFormCancel: ({ sessionID }) => [succeeded(sessionID)],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toEqual([])
    expect(acp.server.cancelledForms).toEqual([{ sessionID: acp.sessionId, formID: "frm_plugin" }])
  })

  test("cancelling the turn cancels its pending elicitation and the form, and never sends queued ones", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        questions(sessionID, "frm_pending"),
        questions(sessionID, "frm_queued"),
      ],
      onInterrupt: ({ sessionID }) => [interrupted(sessionID)],
      elicitation: pendingUntilAborted,
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.elicitations.length === 1, "elicitation request")
    await acp.notify("session/cancel", { sessionId: acp.sessionId })

    expect(await prompt).toMatchObject({ stopReason: "cancelled" })
    await acp.until(() => acp.server.cancelledForms.length === 2, "form cancellation")
    expect(acp.elicitations).toHaveLength(1)
    expect(acp.server.cancelledForms.map((item) => item.formID)).toEqual(["frm_pending", "frm_queued"])
    expect(acp.server.repliedForms).toEqual([])
    expect(acp.received).toContainEqual(firstElicitationCancel(acp.received))
  })

  test("withdraws an elicitation for a form settled elsewhere and moves on to the next ask", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), questions(sessionID, "frm_elsewhere")],
      elicitation: (request, signal) =>
        acp.elicitations.length === 1 ? pendingUntilAborted(request, signal) : accept({ q0: "Node" }),
      onFormReply: ({ sessionID }) => [succeeded(sessionID)],
    })

    const prompt = acp.prompt(acp.sessionId, "hello")
    await acp.until(() => acp.elicitations.length === 1, "elicitation request")
    acp.server.send(
      ephemeralEvent("form.replied", { sessionID: acp.sessionId, id: "frm_elsewhere", answer: { q0: "Bun" } }),
      questions(acp.sessionId, "frm_next"),
    )

    expect((await prompt).stopReason).toBe("end_turn")
    expect(acp.received).toContainEqual(firstElicitationCancel(acp.received))
    expect(acp.elicitations).toHaveLength(2)
    expect(acp.server.repliedForms).toEqual([{ sessionID: acp.sessionId, formID: "frm_next", answer: { q0: "Node" } }])
    expect(acp.server.cancelledForms).toEqual([])
    expect(acp.server.interrupts).toEqual([])
  })

  test("leaves the session alone when the user's answer arrives after the form settled", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true },
      onPrompt: ({ sessionID, id }) => [delivered(sessionID, id), questions(sessionID)],
      elicitation: () => accept({ q0: "Bun" }),
      fetch: (request) => {
        if (!request.path.endsWith("/form/frm_question/reply")) return undefined
        acp.server.send(succeeded(acp.sessionId))
        return Response.json(
          { _tag: "FormAlreadySettledError", id: "frm_question", message: "Form already settled: frm_question" },
          { status: 409 },
        )
      },
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.server.requests.filter((request) => request.path.endsWith("/reply"))).toHaveLength(1)
    expect(acp.server.cancelledForms).toEqual([])
    expect(acp.server.interrupts).toEqual([])
  })

  test("prefixes a foreground child form's tool call and message with the child", async () => {
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

  test("omits the tool call when the child's tool calls only reach the client as child updates", async () => {
    await using acp = await startSession({
      capabilities: { elicitation: true, childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) => [
        delivered(sessionID, id),
        childCreated("ses_child", sessionID, "Review code"),
        questions("ses_child", "frm_child", "call_child"),
      ],
      elicitation: () => accept({ q0: "Node" }),
      onFormReply: ({ sessionID }) => [succeeded(sessionID), succeeded(acp.sessionId)],
    })

    expect((await acp.prompt(acp.sessionId, "hello")).stopReason).toBe("end_turn")
    expect(acp.elicitations).toHaveLength(1)
    expect(acp.elicitations[0]).toMatchObject({ sessionId: acp.sessionId, message: "Review code: Questions" })
    expect(acp.elicitations[0]).not.toHaveProperty("toolCallId")
  })
})
