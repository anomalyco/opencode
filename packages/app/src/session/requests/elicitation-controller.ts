import { createMemo, createSignal, onCleanup, runWithOwner, untrack } from "solid-js"
import type { FormInfo, LocationRef } from "@opencode/client/promise"
import type { Data } from "@opencode/client/solid"
import type { ServerSDK } from "@/runtime/server/client"
import { ScopedKey } from "@/runtime/server/scope"
import { showToast } from "@/shell/notifications/toast"
import {
  ELICITATION_REQUEST_TIMEOUT_MS,
  buildElicitationAnswer,
  createElicitationDockState,
  elicitationFields,
  isElicitationBusy,
  selectElicitationDraft,
  transitionElicitationDock,
  type ElicitationDockEvent,
  type ElicitationDraft,
} from "./elicitation-machine"

const ELICITATION_CACHE_LIMIT = 100

// Drafts of elicitations whose dock unmounted unanswered, newest last. Forms answered or cancelled while their dock is
// away never come back to read theirs, so the oldest give way past the limit.
const drafts = new Map<string, ElicitationDraft>()

export const elicitationCache = {
  get: (key: string) => drafts.get(key),
  set(key: string, draft: ElicitationDraft) {
    drafts.delete(key)
    drafts.set(key, draft)

    if (drafts.size <= ELICITATION_CACHE_LIMIT) return
    const oldest = drafts.keys().next()

    if (!oldest.done) drafts.delete(oldest.value)
  },
  delete: (key: string) => void drafts.delete(key),
}

// The fields, answers and reply of one MCP elicitation dock. The data layer sends the reply: it addresses Location
// elicitations by directory, counts a form already settled elsewhere as sent, and drops the answered form from the list.
export function createElicitationDock(input: {
  sdk: Pick<ServerSDK, "scope" | "event">
  forms: Pick<Data["session"]["form"], "reply" | "cancel">
  language: { t: (key: "common.requestFailed") => string }
  request: () => FormInfo & { location?: LocationRef }
  onSubmit: () => void
}) {
  const serverSDK = input.sdk
  const cacheKey = ScopedKey.from(serverSDK.scope, untrack(input.request).id)
  const fields = createMemo(() => elicitationFields(input.request().fields))

  const [dockState, setDockState] = createSignal(
    createElicitationDockState(untrack(input.request).fields, elicitationCache.get(cacheKey)),
  )

  let timeout: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ElicitationDockEvent) => {
    const prev = untrack(dockState)
    const result = transitionElicitationDock(prev, event)

    if (result.state !== prev) setDockState(result.state)

    if (result.state.status === "disposed" && !result.state.unsent) unlisten()
    result.effects.forEach((effect) => {
      if (effect.type === "notify.submit") return input.onSubmit()

      if (effect.type === "cache.save") return elicitationCache.set(cacheKey, effect.draft)

      if (effect.type === "cache.delete") return elicitationCache.delete(cacheKey)

      if (effect.type === "timeout.clear") return clearTimeout(timeout)

      if (effect.type === "toast.fail")
        return showToast({ title: input.language.t("common.requestFailed"), description: effect.error })

      const request = untrack(input.request)
      const attempt = effect.attempt
      const action = effect.action
      const target = { sessionID: request.sessionID, formID: request.id }
      clearTimeout(timeout)
      timeout = setTimeout(() => dispatch({ type: "request.timed-out", attempt }), ELICITATION_REQUEST_TIMEOUT_MS)

      void Promise.try(() =>
        action.type === "reply"
          ? input.forms.reply({ ...target, answer: action.answer }, request.location)
          : input.forms.cancel(target, request.location),
      ).then(
        () => dispatch({ type: "request.succeeded", attempt }),
        (error) =>
          dispatch({ type: "request.failed", attempt, error: error instanceof Error ? error.message : String(error) }),
      )
    })
  }

  const resolved = (event: { data: { id: string } }) => {
    if (event.data.id === untrack(input.request).id) dispatch({ type: "resolved" })
  }

  // The form's settling events are heard until the reply settles, not only while the dock is mounted: a reply whose
  // response stalls after the server accepted it ends on `form.replied`, not on a false timeout. Subscribed outside the
  // owner, since the event bus otherwise drops the listeners when the dock unmounts.
  const listeners = runWithOwner(null, () => [
    serverSDK.event.on("form.replied", resolved),
    serverSDK.event.on("form.cancelled", resolved),
  ])

  const unlisten = () => listeners?.forEach((off) => off())

  // A reply already sent keeps going without the dock, with its timeout, so a failure still reports and keeps the draft.
  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    fields,
    busy: () => isElicitationBusy(dockState()),
    draft: () => selectElicitationDraft(dockState()),
    setText: (key: string, value: string) => dispatch({ type: "text.set", key, value }),
    setNumber: (key: string, value: string) => dispatch({ type: "number.set", key, value }),
    setFlag: (key: string, value: boolean) => dispatch({ type: "flag.set", key, value }),
    toggle: (key: string, value: string, checked: boolean) => dispatch({ type: "list.toggle", key, value, checked }),
    reply() {
      const current = untrack(dockState)

      if (current.status !== "answering") return
      dispatch({ type: "send", action: { type: "reply", answer: buildElicitationAnswer(fields(), current.draft) } })
    },
    dismiss: () => dispatch({ type: "send", action: { type: "cancel" } }),
  }
}
