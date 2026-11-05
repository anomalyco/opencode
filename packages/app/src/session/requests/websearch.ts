import {
  isFormAlreadySettledError,
  isFormNotFoundError,
  type FormInfo,
  type FormOption,
  type SessionFormReplyInput,
} from "@opencode/client/promise"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import type { OpenCodeEventStream } from "@/runtime/server/client"
import {
  createWebSearchState,
  selectWebSearchView,
  transitionWebSearch,
  type WebSearchEffect,
  type WebSearchEvent,
} from "./websearch-machine"

export function createWebSearchRequest(input: {
  owner: () => string | undefined
  connected: () => boolean
  request: () => FormInfo | undefined
  providers: (sessionID: string) => Promise<FormOption[]>
  reply: (input: SessionFormReplyInput) => Promise<unknown>
  events: Pick<OpenCodeEventStream, "listen">
}) {
  const [machine, setMachine] = createSignal(createWebSearchState(input.connected()))
  // Read through the signal rather than a memo, so the model still reports its final state after its owner is disposed.
  const view = () => selectWebSearchView(machine())
  let providerTimer: ReturnType<typeof setTimeout> | undefined
  let respondTimer: ReturnType<typeof setTimeout> | undefined
  let stopEvents: VoidFunction | undefined
  let respondDone: PromiseWithResolvers<void> | undefined

  const dispatch = (event: WebSearchEvent) => {
    const next = transitionWebSearch(machine(), event)

    // The state is written before effects run, so an event an effect dispatches synchronously sees it.
    if (next.state !== machine()) setMachine(next.state)
    next.effects.forEach(
      (effect) => void Promise.try(() => run(effect)).catch((cause: unknown) => console.error("[websearch]", cause)),
    )
  }

  const run = (effect: WebSearchEffect) => {
    if (effect.type === "providers.load") {
      clearTimeout(providerTimer)
      const timer = setTimeout(
        () => dispatch({ type: "providers.timed-out", attempt: effect.attempt }),
        effect.timeoutMs,
      )
      providerTimer = timer

      return void Promise.try(() => input.providers(effect.sessionID))
        .then(
          (options) => dispatch({ type: "providers.loaded", attempt: effect.attempt, options }),
          () => dispatch({ type: "providers.failed", attempt: effect.attempt }),
        )
        .finally(() => clearTimeout(timer))
    }

    if (effect.type === "respond.start") {
      stopEvents?.()
      respondDone?.resolve()
      respondDone = Promise.withResolvers<void>()
      stopEvents = input.events.listen((event) => {
        if (event.type === "form.created") return dispatch({ type: "form.created", form: event.data.form })

        if (event.type === "form.cancelled") return dispatch({ type: "form.cancelled", id: event.data.id })

        if (event.type === "form.replied")
          dispatch({ type: "form.replied", id: event.data.id, answer: event.data.answer })
      })

      return
    }

    if (effect.type === "reply.send") {
      clearTimeout(respondTimer)
      respondTimer = setTimeout(() => dispatch({ type: "reply.timed-out", attempt: effect.attempt }), effect.timeoutMs)
      const result = { attempt: effect.attempt, formID: effect.formID, kind: effect.kind }

      return void Promise.try(() =>
        input.reply({ sessionID: effect.sessionID, formID: effect.formID, answer: effect.answer }),
      ).then(
        () => dispatch({ type: "reply.succeeded", ...result }),
        (error: unknown) =>
          dispatch(
            // Another client or the server's timeout settled the form first; it no longer waits for this answer.
            (isFormNotFoundError(error) || isFormAlreadySettledError(error)) && error.id === effect.formID
              ? { type: "reply.already-settled", ...result }
              : { type: "reply.failed", attempt: effect.attempt },
          ),
      )
    }

    if (effect.type === "handoff.wait") {
      clearTimeout(respondTimer)
      respondTimer = setTimeout(
        () => dispatch({ type: "handoff.timed-out", attempt: effect.attempt }),
        effect.timeoutMs,
      )

      return
    }

    clearTimeout(respondTimer)
    stopEvents?.()
    stopEvents = undefined
    respondDone?.resolve()
    respondDone = undefined
  }

  dispatch({ type: "request.changed", form: input.request() })
  createEffect(on(input.request, (form) => dispatch({ type: "request.changed", form }), { defer: true }))
  createEffect(on(input.owner, () => dispatch({ type: "owner.changed" }), { defer: true }))
  createEffect(on(input.connected, (connected) => dispatch({ type: "connection.changed", connected }), { defer: true }))
  onCleanup(() => {
    dispatch({ type: "disposed" })
    clearTimeout(providerTimer)
  })

  // Resolves when the response this call started ends; a call the machine ignores resolves at once.
  const submit = (selection: string | false) => {
    const before = machine()
    dispatch({ type: "submit", selection })
    const after = machine()

    if (after === before || after.status !== "responding") return Promise.resolve()

    return respondDone?.promise ?? Promise.resolve()
  }

  return {
    request: () => view().request,
    options: () => view().options,
    selected: () => view().selected,
    specific: () => view().specific,
    loading: () => view().loading,
    loadFailed: () => view().loadFailed,
    failed: () => view().failed,
    optionUnavailable: () => view().optionUnavailable,
    sending: () => view().sending,
    connected: input.connected,
    select: (value: string) => dispatch({ type: "select", value }),
    retry: () => dispatch({ type: "retry" }),
    submit,
  }
}

export type WebSearchRequestModel = ReturnType<typeof createWebSearchRequest>
