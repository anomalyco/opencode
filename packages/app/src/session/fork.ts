import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { base64Encode } from "@opencode/util/encode"
import { useComposerState } from "@/composer/persistence"
import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData, useServer } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { sessionHref } from "@/shell/routes/session"
import { useWorkspaceLocation } from "@/workspaces/location"
import {
  createSessionForkState,
  selectSessionForkView,
  transitionSessionFork,
  type SessionForkEffect,
  type SessionForkEvent,
} from "./fork-machine"

export type SessionForkControllerOptions =
  | { readonly surface: "inline" }
  | { readonly surface: "dialog"; readonly closing: Accessor<boolean>; readonly onClose: () => void }

/**
 * Forks a session before one of its prompts: the new session keeps the history above the prompt, opens, and has the
 * prompt back in its composer to edit and send. One fork runs at a time; `fork` resolves to whether it opened.
 */
export function createSessionForkController(options: SessionForkControllerOptions) {
  const navigate = useNavigate()
  const params = useParams()
  const data = useData()
  const serverSDK = useServerSDK()
  const location = useWorkspaceLocation()
  const prompt = useComposerState()
  const language = useLanguage()
  const server = useServer()
  const [machine, setMachine] = createSignal(createSessionForkState(options.surface))

  const runs = new Map<
    number,
    { controller: AbortController; timer: ReturnType<typeof setTimeout>; done: PromiseWithResolvers<boolean> }
  >()

  const dispatch = (event: SessionForkEvent) => {
    const next = transitionSessionFork(machine(), event)

    if (next.state !== machine()) setMachine(next.state)
    next.effects.forEach((effect) =>
      Promise.try(() => run(effect)).catch((cause: unknown) => console.error("[fork]", cause)),
    )
  }

  // Ends the run's bookkeeping; the run's own result arrives later, if at all, and the machine drops it.
  const settle = (attempt: number, opened: boolean) => {
    const entry = runs.get(attempt)

    if (!entry) return
    runs.delete(attempt)
    clearTimeout(entry.timer)
    entry.done.resolve(opened)

    return entry
  }

  const run = (effect: SessionForkEffect) => {
    if (effect.type === "fork.start") {
      const controller = new AbortController()
      runs.set(effect.attempt, {
        controller,
        timer: setTimeout(() => dispatch({ type: "fork.timed-out", attempt: effect.attempt }), effect.timeoutMs),
        done: Promise.withResolvers<boolean>(),
      })
      serverSDK.api.session
        .fork({ sessionID: effect.sessionID, before: effect.messageID }, { signal: controller.signal })
        .then(
          (session) => dispatch({ type: "fork.succeeded", attempt: effect.attempt, session }),
          (cause: unknown) =>
            dispatch({
              type: "fork.failed",
              attempt: effect.attempt,
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        )

      return
    }

    if (effect.type === "fork.cancel") return settle(effect.attempt, false)?.controller.abort()

    if (effect.type === "fork.open") {
      data.session.remember(effect.session)
      const target = prompt.capture({ dir: base64Encode(effect.session.location.directory), id: effect.session.id })
      target.set(effect.draft.prompt)
      target.context.replace([...effect.draft.context])
      navigate(sessionHref(server.key, effect.session.id))
      settle(effect.attempt, true)

      return
    }

    if (effect.type === "dialog.close") return options.surface === "dialog" ? options.onClose() : undefined

    settle(effect.attempt, false)
    showToast({ title: language.t("common.requestFailed"), description: effect.message })
  }

  const fork = (input: { sessionID: string; messageID: string }) => {
    const message = data.session.message.get(input.sessionID, input.messageID)

    if (message?.type !== "user") return Promise.resolve(false)

    // The prompt's paths are relative to the session it was sent in.
    const directory = data.session.get(input.sessionID)?.location.directory ?? location().directory
    const context = extractPromptContext(message, { directory })
    const before = machine()

    dispatch({
      type: "fork.requested",
      sessionID: input.sessionID,
      messageID: input.messageID,
      draft: {
        prompt: extractPromptFromMessage(message, {
          directory,
          attachmentName: language.t("common.attachment"),
          sessionTitle: (id) => data.session.get(id)?.title,
        }),
        context: [...context.comments, ...context.files],
      },
    })
    const after = machine()

    if (after === before || after.status !== "forking") return Promise.resolve(false)

    return runs.get(after.attempt)?.done.promise ?? Promise.resolve(false)
  }

  createEffect(
    on(
      () => params.id,
      () => dispatch({ type: "session.changed" }),
      { defer: true },
    ),
  )

  if (options.surface === "dialog") {
    createEffect(() => {
      if (options.closing()) dispatch({ type: "disposed" })
    })
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    fork,
    view: () => selectSessionForkView(machine()),
  }
}

/** The timeline's "Fork from here", resolving to whether the fork opened. */
export function useSessionFork() {
  const controller = createSessionForkController({ surface: "inline" })

  return (input: { sessionID: string; messageID: string }) => controller.fork(input)
}
