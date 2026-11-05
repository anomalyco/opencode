import { createMemo, createSignal, onCleanup, untrack } from "solid-js"
import type { FormInfo } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey } from "@/runtime/server/scope"
import { showToast } from "@/shell/notifications/toast"
import {
  QUESTION_REQUEST_TIMEOUT_MS,
  buildFormAnswer,
  createQuestionDockState,
  isQuestionBusy,
  questionAnswer,
  questionDraft,
  questionSpecs,
  questionTab,
  transitionQuestionDock,
  type QuestionDockEvent,
} from "./question-machine"
import { questionCache } from "./question-state"

// The answers, the question shown and the reply of one question dock, shared by both dock variants. Focus, the
// custom field's editing and minimizing stay with each variant.
export function createQuestionDock(input: { request: () => FormInfo; onSubmit: () => void }) {
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const cacheKey = ScopedKey.from(serverSDK.scope, untrack(input.request).id)
  const questions = createMemo(() => questionSpecs(input.request()))

  const [dockState, setDockState] = createSignal(
    createQuestionDockState(untrack(questions).length, questionCache.get(cacheKey)),
  )

  let controller: AbortController | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined

  const abort = () => {
    clearTimeout(timeout)
    controller?.abort()
    timeout = undefined
    controller = undefined
  }

  const dispatch = (event: QuestionDockEvent) => {
    const prev = untrack(dockState)
    const result = transitionQuestionDock(prev, event)

    if (result.state !== prev) setDockState(result.state)
    result.effects.forEach((effect) => {
      if (effect.type === "notify.submit") return input.onSubmit()

      if (effect.type === "cache.save") return questionCache.set(cacheKey, effect.snapshot)

      if (effect.type === "cache.delete") return questionCache.delete(cacheKey)

      if (effect.type === "request.abort") return abort()

      if (effect.type === "toast.fail")
        return showToast({ title: language.t("common.requestFailed"), description: effect.error })

      abort()
      const current = new AbortController()
      const attempt = effect.attempt
      const action = effect.action
      const request = untrack(input.request)
      const target = { sessionID: request.sessionID, formID: request.id }
      controller = current
      timeout = setTimeout(() => dispatch({ type: "request.timed-out", attempt }), QUESTION_REQUEST_TIMEOUT_MS)

      void Promise.try(() =>
        action.type === "reply"
          ? serverSDK.api.session.form.reply({ ...target, answer: action.answer }, { signal: current.signal })
          : serverSDK.api.session.form.cancel(target, { signal: current.signal }),
      ).then(
        () => dispatch({ type: "request.succeeded", attempt }),
        (error: Error) => dispatch({ type: "request.failed", attempt, error: error.message }),
      )
    })
  }

  const settled = (event: { data: { id: string } }) => {
    if (event.data.id === untrack(input.request).id) dispatch({ type: "resolved" })
  }

  onCleanup(serverSDK.event.on("form.replied", settled))
  onCleanup(serverSDK.event.on("form.cancelled", settled))
  onCleanup(() => {
    dispatch({ type: "disposed" })
    // A reply already sent keeps going without the dock; only its timeout goes.
    clearTimeout(timeout)
  })

  const tab = createMemo(() => questionTab(dockState()))
  const draft = (index: number) => questionDraft(dockState(), index)

  return {
    questions,
    tab,
    busy: () => isQuestionBusy(dockState()),
    draft,
    answered: (index: number) => {
      const spec = questions()[index]

      return !!spec && questionAnswer(spec, draft(index)).length > 0
    },
    selectTab: (index: number) => dispatch({ type: "tab.select", tab: index }),
    pick: (value: string) => dispatch({ type: "option.pick", value, multiple: questions()[tab()]?.multiple === true }),
    input: (text: string) => dispatch({ type: "custom.input", text, multiple: questions()[tab()]?.multiple === true }),
    selectCustom: () => dispatch({ type: "custom.select", multiple: questions()[tab()]?.multiple === true }),
    deselectCustom: () => dispatch({ type: "custom.deselect" }),
    reply() {
      const current = untrack(dockState)

      if (current.status !== "answering") return
      dispatch({ type: "send", action: { type: "reply", answer: buildFormAnswer(questions(), current.drafts) } })
    },
    dismiss: () => dispatch({ type: "send", action: { type: "dismiss" } }),
  }
}

export type QuestionDock = ReturnType<typeof createQuestionDock>
