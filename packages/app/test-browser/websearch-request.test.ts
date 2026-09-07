import { afterEach, describe, expect, test } from "bun:test"
import type { FormCreated, FormReplyInput, OpenCodeEvent } from "@opencode-ai/client/promise"
import { createEffect, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createWebSearchRequest } from "@/session/requests/websearch"

const consent: FormCreated["data"]["form"] = {
  id: "frm_consent",
  sessionID: "ses_child",
  title: "Web Search",
  metadata: { kind: "websearch.provider" },
  fields: [{ key: "choice", type: "string", required: true, custom: false }],
}
const options = [
  { value: "exa", label: "Exa" },
  { value: "parallel", label: "Parallel" },
]
const provider: FormCreated["data"]["form"] = {
  ...consent,
  id: "frm_provider",
  fields: [{ key: "provider", type: "string", options, required: true, custom: false }],
}

const cleanups: VoidFunction[] = []
afterEach(() => cleanups.splice(0).forEach((dispose) => dispose()))

function ready(condition: () => boolean) {
  return new Promise<void>((resolve) => {
    createRoot((dispose) => {
      cleanups.push(dispose)
      createEffect(() => {
        if (!condition()) return
        dispose()
        resolve()
      })
    })
  })
}

function fixture(form: FormCreated["data"]["form"] | null = consent) {
  return createRoot((dispose) => {
    cleanups.push(dispose)
    const listeners = new Set<(event: OpenCodeEvent) => void>()
    const replies: FormReplyInput[] = []
    const loads: string[] = []
    const [state, setState] = createStore({
      request: form ?? undefined,
      owner: "ses_root",
      connected: true,
      loadFails: false,
      replyFails: false,
    })
    const model = createWebSearchRequest({
      owner: () => state.owner,
      connected: () => state.connected,
      request: () => state.request,
      providers: async (sessionID) => {
        loads.push(sessionID)
        if (state.loadFails) throw new Error("offline")
        return options
      },
      reply: async (input) => {
        replies.push(input)
        if (state.replyFails) throw new Error("offline")
        setState("request", undefined)
      },
      events: {
        listen(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
      },
    })
    return {
      model,
      state,
      setState,
      replies,
      loads,
      dispose,
      listeners,
      create(form = provider) {
        setState("request", form)
        listeners.forEach((listener) =>
          listener({
            id: "evt_create",
            created: 0,
            type: "form.created",
            data: { form },
          }),
        )
      },
      cancel(id: string) {
        setState("request", undefined)
        listeners.forEach((listener) =>
          listener({
            id: "evt_cancel",
            created: 0,
            type: "form.cancelled",
            data: { id, sessionID: consent.sessionID },
          }),
        )
      },
    }
  })
}

describe("web search request state", () => {
  test("loads providers for the form owner, not the viewed parent, and waits for consent", async () => {
    const input = fixture()
    await ready(() => !input.model.loading())
    expect(input.loads).toEqual(["ses_child"])
    expect(input.model.selected()).toBe("random")
    input.model.select("exa")
    expect(input.replies).toEqual([])
    await input.model.submit(false)
    expect(input.replies[0]?.answer).toEqual({ choice: "disable" })
    expect(input.model.request()).toBeUndefined()
    expect(input.model.sending()).toBe(false)
  })

  test("does not load providers when there is no consent request", () => {
    const input = fixture(null)
    expect(input.model.request()).toBeUndefined()
    expect(input.loads).toEqual([])
  })

  test("holds the card across both forms and prevents duplicate submissions", async () => {
    const input = fixture()
    await ready(() => !input.model.loading())
    input.model.select("parallel")
    const pending = input.model.submit("parallel")
    await input.model.submit("parallel")
    expect(input.state.request).toBeUndefined()
    expect(input.model.request()?.id).toBe(consent.id)
    expect(input.model.sending()).toBe(true)
    input.create()
    await pending
    expect(input.replies.map((reply) => reply.answer)).toEqual([{ choice: "choose" }, { provider: "parallel" }])
    expect(input.model.request()).toBeUndefined()
    expect(input.model.sending()).toBe(false)
    expect(input.listeners.size).toBe(0)
  })

  test("direct provider requests need confirmation and do not load a different provider list", async () => {
    const input = fixture(provider)
    await ready(() => !input.model.loading())
    expect(input.loads).toEqual([])
    expect(input.model.specific()).toBe(true)
    expect(input.model.options()).toEqual(options)
    expect(input.replies).toEqual([])
    await input.model.submit("exa")
    expect(input.replies.map((reply) => reply.answer)).toEqual([{ provider: "exa" }])
  })

  test("keeps the selected provider after failure and retries only the provider form", async () => {
    const input = fixture()
    await ready(() => !input.model.loading())
    input.model.select("parallel")
    const pending = input.model.submit("parallel")
    input.setState("replyFails", true)
    input.create()
    await pending
    expect(input.model.failed()).toBe(true)
    expect(input.model.sending()).toBe(false)
    expect(input.model.request()?.id).toBe(provider.id)
    expect(input.model.selected()).toBe("parallel")
    input.setState("replyFails", false)
    await input.model.submit("parallel")
    expect(input.replies.map((reply) => reply.answer)).toEqual([
      { choice: "choose" },
      { provider: "parallel" },
      { provider: "parallel" },
    ])
    expect(input.model.request()).toBeUndefined()
  })

  test("can retry loading providers without submitting consent", async () => {
    const input = fixture()
    await ready(() => !input.model.loading())
    input.setState("loadFails", true)
    input.model.retry()
    await ready(() => input.model.loadFailed())
    expect(input.model.options()).toEqual([])
    input.setState("loadFails", false)
    input.model.retry()
    await ready(() => !input.model.loading())
    expect(input.model.options()).toEqual(options)
    expect(input.model.loadFailed()).toBe(false)
    expect(input.replies).toEqual([])
  })

  test.each(["navigate", "disconnect", "dispose", "cancel"])("stops automatic replies on %s", async (action) => {
    const input = fixture()
    await ready(() => !input.model.loading())
    const pending = input.model.submit("exa")
    if (action === "navigate") input.setState("owner", "ses_other")
    if (action === "disconnect") input.setState("connected", false)
    if (action === "dispose") input.dispose()
    if (action === "cancel") input.cancel(consent.id)
    await pending
    expect(input.model.sending()).toBe(false)
    expect(input.listeners.size).toBe(0)
    input.create()
    expect(input.replies.map((reply) => reply.answer)).toEqual([{ choice: "choose" }])
  })
})
