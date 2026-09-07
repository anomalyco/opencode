import type { FormInfo, FormOption, FormReplyInput, FormStringField } from "@opencode-ai/client/promise"
import { createEffect, createMemo, createResource, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { OpenCodeEventStream } from "@/runtime/server/client"

export function webSearchProviderField(form: FormInfo) {
  return form.fields.find(
    (field): field is FormStringField => field.type === "string" && field.key === "provider" && !!field.options,
  )
}

export function createWebSearchRequest(input: {
  owner: () => string | undefined
  connected: () => boolean
  request: () => FormInfo | undefined
  providers: (sessionID: string) => Promise<FormOption[]>
  reply: (input: FormReplyInput) => Promise<unknown>
  events: Pick<OpenCodeEventStream, "listen">
}) {
  const [store, setStore] = createStore({
    selected: "random",
    sending: undefined as { form: FormInfo; abort: AbortController } | undefined,
    error: false,
  })
  const [providers, resource] = createResource(input.request, async (form) => {
    const field = webSearchProviderField(form)
    if (field) return field.options ?? []
    return input.providers(form.sessionID)
  })
  const request = createMemo(() => store.sending?.form ?? input.request())
  const specific = createMemo(() => {
    const form = request()
    return !!form && !!webSearchProviderField(form)
  })
  const options = createMemo(() => (providers.error ? [] : (providers() ?? [])))
  const selected = createMemo(() => {
    if (!specific()) return store.selected
    return options().some((option) => option.value === store.selected) ? store.selected : options()[0]?.value
  })

  createEffect(
    on([input.owner, input.connected], () => {
      store.sending?.abort.abort()
      setStore({ sending: undefined, selected: "random", error: false })
    }),
  )
  createEffect(
    on(
      () => input.request()?.id,
      () => {
        const form = input.request()
        if (!form || store.sending || webSearchProviderField(form)) return
        setStore({ selected: "random", error: false })
      },
    ),
  )
  onCleanup(() => store.sending?.abort.abort())

  const submit = async (selection: string | false) => {
    const form = input.request()
    if (!form || store.sending || !input.connected()) return
    if (selection === false && webSearchProviderField(form)) return
    const sending = { form, abort: new AbortController() }
    setStore({ sending, error: false })
    await replyWebSearch({ ...input, form, selection, signal: sending.abort.signal })
      .catch(() => {
        if (!sending.abort.signal.aborted) setStore("error", true)
      })
      .finally(() => {
        if (store.sending?.abort === sending.abort) setStore("sending", undefined)
      })
  }

  return {
    request,
    options,
    selected,
    specific,
    loading: () => providers.loading,
    loadFailed: () => !!providers.error,
    failed: () => store.error,
    sending: () => !!store.sending,
    connected: input.connected,
    select: (value: string) => setStore({ selected: value, error: false }),
    retry: () => void resource.refetch(),
    submit,
  }
}

export type WebSearchRequestModel = ReturnType<typeof createWebSearchRequest>

export async function replyWebSearch(input: {
  form: FormInfo
  selection: string | false
  signal: AbortSignal
  reply: (input: FormReplyInput) => Promise<unknown>
  events: Pick<OpenCodeEventStream, "listen">
}) {
  if (input.signal.aborted) return
  if (webSearchProviderField(input.form)) {
    if (input.selection === false) return
    return input.reply({
      sessionID: input.form.sessionID,
      formID: input.form.id,
      answer: { provider: input.selection },
    })
  }
  if (input.selection === false || input.selection === "random") {
    return input.reply({
      sessionID: input.form.sessionID,
      formID: input.form.id,
      answer: { choice: input.selection === false ? "disable" : "allow" },
    })
  }

  const next = Promise.withResolvers<FormInfo | undefined>()
  const stop = input.events.listen((event) => {
    if (event.type === "form.created") {
      const form = event.data.form
      if (
        form.sessionID !== input.form.sessionID ||
        form.id === input.form.id ||
        form.metadata?.kind !== "websearch.provider" ||
        !webSearchProviderField(form)
      )
        return
      next.resolve(form)
    }
    if (event.type === "form.cancelled" && event.data.id === input.form.id) next.resolve(undefined)
    if (event.type === "form.replied" && event.data.id === input.form.id && event.data.answer.choice !== "choose")
      next.resolve(undefined)
  })
  const cancel = () => next.resolve(undefined)
  input.signal.addEventListener("abort", cancel, { once: true })

  return Promise.all([
    input.reply({ sessionID: input.form.sessionID, formID: input.form.id, answer: { choice: "choose" } }),
    next.promise,
  ])
    .then(([, form]) => {
      if (!form || input.signal.aborted) return
      const field = webSearchProviderField(form)
      if (!field?.options?.some((option) => option.value === input.selection)) return
      return input.reply({
        sessionID: form.sessionID,
        formID: form.id,
        answer: { provider: input.selection },
      })
    })
    .finally(() => {
      stop()
      input.signal.removeEventListener("abort", cancel)
    })
}
