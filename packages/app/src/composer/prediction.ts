import { createEffect, onCleanup, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { makeEventListener } from "@solid-primitives/event-listener"
import type { ServerSDK } from "@/runtime/server/client"

const prompt = `Predict the user's next message from the conversation so far.
Write one short, natural follow-up from the user's perspective, in the user's language.
Suggest only an obvious next step supported by the conversation. Do not invent new work,
repeat a completed request, or propose destructive actions or external side effects.
Return only the suggested message, without quotes, markdown, explanation, or a label.
Keep it under 200 characters. If no useful follow-up is clear, return exactly NO_SUGGESTION.`

export function createComposerPrediction(input: {
  sessionID: string
  eligible: Accessor<boolean>
  sdk: Pick<ServerSDK, "api" | "event">
}) {
  const [state, setState] = createStore({
    text: undefined as string | undefined,
    active: document.visibilityState === "visible" && document.hasFocus(),
  })
  const update = () => setState("active", document.visibilityState === "visible" && document.hasFocus())
  makeEventListener(window, "focus", update)
  makeEventListener(window, "blur", update)
  makeEventListener(document, "visibilitychange", update)
  const eligible = () => state.active && input.eligible()
  let request: AbortController | undefined
  let completed: string | undefined

  const dismiss = () => {
    request?.abort()
    request = undefined
    setState("text", undefined)
  }

  createEffect(() => {
    if (!eligible()) dismiss()
  })

  const unsubscribe = input.sdk.event.on("session.execution.succeeded", (event) => {
    if (event.data.sessionID !== input.sessionID || event.id === completed) return
    completed = event.id
    dismiss()

    if (!eligible()) return
    const current = new AbortController()
    request = current
    void input.sdk.api.session.generate({ sessionID: input.sessionID, prompt }, { signal: current.signal }).then(
      (result) => {
        if (current.signal.aborted || !eligible()) return
        request = undefined
        if (result.text.trimStart().startsWith("```")) return
        const text = result.text
          .trim()
          .split(/[\r\n\u2028\u2029]/u, 1)[0]!
          .trim()
          .replace(/^(?:"(.*)"|'(.*)'|`(.*)`|“(.*)”|‘(.*)’)$/u, "$1$2$3$4$5")
          .trim()

        if (text && text.length <= 200 && text !== "NO_SUGGESTION") setState("text", text)
      },
      () => {
        if (request === current) request = undefined
      },
    )
  })

  onCleanup(() => {
    unsubscribe()
    dismiss()
  })

  return { text: () => state.text, dismiss }
}

export type ComposerPrediction = ReturnType<typeof createComposerPrediction>
