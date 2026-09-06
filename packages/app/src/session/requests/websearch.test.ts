import { describe, expect, test } from "bun:test"
import type { FormAnswer, FormCreated, FormReplyInput, OpenCodeEvent } from "@opencode-ai/client/promise"
import { replyWebSearch } from "./websearch"

const consent: FormCreated["data"]["form"] = {
  id: "frm_consent",
  sessionID: "ses_child",
  title: "Web Search",
  metadata: { kind: "websearch.provider" },
  fields: [{ key: "choice", type: "string", required: true, custom: false }],
}
const provider: FormCreated["data"]["form"] = {
  ...consent,
  id: "frm_provider",
  fields: [
    {
      key: "provider",
      type: "string",
      required: true,
      custom: false,
      options: [
        { value: "exa", label: "Exa" },
        { value: "parallel", label: "Parallel" },
      ],
    },
  ],
}

function fixture() {
  const listeners = new Set<(event: OpenCodeEvent) => void>()
  const replies: FormReplyInput[] = []
  const abort = new AbortController()
  const emit = (event: OpenCodeEvent) => listeners.forEach((listener) => listener(event))
  return {
    form: consent,
    signal: abort.signal,
    abort,
    listeners,
    replies,
    events: {
      listen(listener: (event: OpenCodeEvent) => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    reply: async (input: FormReplyInput) => {
      replies.push(input)
    },
    create: (form = provider) => emit({ id: "evt_create", created: 0, type: "form.created", data: { form } }),
    cancel: (id: string) =>
      emit({
        id: "evt_cancel",
        created: 0,
        type: "form.cancelled",
        data: { id, sessionID: consent.sessionID },
      }),
    answer: (id: string, answer: FormAnswer) =>
      emit({
        id: "evt_reply",
        created: 0,
        type: "form.replied",
        data: { id, sessionID: consent.sessionID, answer },
      }),
  }
}

describe("web search desktop consent", () => {
  test.each([
    ["random", "allow"],
    [false, "disable"],
  ] as const)("submits %s without a second form", async (selection, choice) => {
    const input = fixture()
    await replyWebSearch({ ...input, selection })
    expect(input.replies).toEqual([{ sessionID: consent.sessionID, formID: consent.id, answer: { choice } }])
    expect(input.listeners.size).toBe(0)
  })

  test("subscribes before the first reply and answers the owning session's provider form", async () => {
    const input = fixture()
    await replyWebSearch({
      ...input,
      selection: "parallel",
      reply: async (answer) => {
        input.replies.push(answer)
        if (answer.answer.choice === "choose") input.create()
      },
    })
    expect(input.replies).toEqual([
      { sessionID: consent.sessionID, formID: consent.id, answer: { choice: "choose" } },
      { sessionID: consent.sessionID, formID: provider.id, answer: { provider: "parallel" } },
    ])
    expect(input.listeners.size).toBe(0)
  })

  test("ignores questions, other sessions, and repeated consent forms during handoff", async () => {
    const input = fixture()
    const pending = replyWebSearch({ ...input, selection: "exa" })
    input.create({ ...provider, sessionID: "ses_other" })
    input.create({ ...provider, metadata: { kind: "question" } })
    input.create(consent)
    input.create()
    await pending
    expect(input.replies).toHaveLength(2)
    expect(input.replies[1]?.formID).toBe(provider.id)
  })

  test("leaves a changed provider list for explicit confirmation", async () => {
    const input = fixture()
    const pending = replyWebSearch({ ...input, selection: "removed" })
    input.create()
    await pending
    expect(input.replies).toHaveLength(1)
    expect(input.listeners.size).toBe(0)
  })

  test("supports direct entry into the provider form", async () => {
    const input = fixture()
    await replyWebSearch({ ...input, form: provider, selection: "exa" })
    expect(input.replies).toEqual([{ sessionID: consent.sessionID, formID: provider.id, answer: { provider: "exa" } }])
    expect(input.listeners.size).toBe(0)
  })

  test("does not misrepresent cancelling the provider form as disabling search", async () => {
    const input = fixture()
    await replyWebSearch({ ...input, form: provider, selection: false })
    expect(input.replies).toEqual([])
  })

  test.each(["cancel", "other-client", "abort"])("ends a pending handoff on %s", async (action) => {
    const input = fixture()
    const pending = replyWebSearch({ ...input, selection: "exa" })
    if (action === "cancel") input.cancel(consent.id)
    if (action === "other-client") input.answer(consent.id, { choice: "disable" })
    if (action === "abort") input.abort.abort()
    await pending
    input.create()
    expect(input.replies).toHaveLength(1)
    expect(input.listeners.size).toBe(0)
  })

  test("cleans up after a failed consent submission", async () => {
    const input = fixture()
    await expect(
      replyWebSearch({
        ...input,
        selection: "exa",
        reply: async () => {
          throw new Error("offline")
        },
      }),
    ).rejects.toThrow("offline")
    expect(input.listeners.size).toBe(0)
  })

  test("propagates provider submission failures for retry", async () => {
    const input = fixture()
    await expect(
      replyWebSearch({
        ...input,
        selection: "exa",
        reply: async (answer) => {
          if (answer.formID === provider.id) throw new Error("offline")
          input.create()
        },
      }),
    ).rejects.toThrow("offline")
    expect(input.listeners.size).toBe(0)
  })
})
