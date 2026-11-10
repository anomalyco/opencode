import type { SessionMessageUser } from "@opencode/client/promise"
import { toaster } from "@opencode/ui/toast"
import { createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { useComposerState } from "@/composer/persistence"
import { useData } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useLanguage } from "@/runtime/i18n/language"

import { extractPromptContext, extractPromptFromMessage } from "@/composer/prompt"
import { pinPromptMedia } from "@/composer/media"
import { clonePrompt, promptLength } from "@/composer/prompt-parts"
import { showToast } from "@/shell/notifications/toast"
import type { SessionModel } from "./model"
import {
  createSessionRevertState,
  REVERT_TIMEOUT_MS,
  transitionSessionRevert,
  viewSessionRevert,
  type SessionRevertEffect,
  type SessionRevertEvent,
  type SessionRevertOperation,
  type SessionRevertState,
} from "./revert-machine"
import { selectSessionUserMessages } from "./session-domain"

const IDLE = createSessionRevertState()

export function createSessionRevert(input: {
  session: SessionModel
  setActiveMessage: (messageID: string | undefined) => void
}) {
  const prompt = useComposerState()
  const server = useServerSDK()
  const data = useData()
  const location = useWorkspaceLocation()
  const language = useLanguage()

  // One revert lifecycle per Session: this stays mounted while tabs switch, and a rewind can settle in the background.
  const [sessions, setSessions] = createSignal<Readonly<Record<string, SessionRevertState>>>({})
  // The composer and directory a Session's rewind started from, kept while it runs or can be undone, so a result that
  // lands after a tab switch still restores the Session it came from.
  const targets = new Map<string, RevertTarget>()
  const runs = new Map<string, Run>()
  let rewound: { sessionID: string; id: number } | undefined

  const view = createMemo(() => {
    const sessionID = input.session.identity.params.id

    return viewSessionRevert((sessionID && sessions()[sessionID]) || IDLE, {
      messages: input.session.history.userMessages(),
      revertMessageID: input.session.data.revertMessageID(),
    })
  })

  onCleanup(
    data.on("session.revert.staged", (event) =>
      dispatch(event.data.sessionID, { type: "revert.staged", messageID: event.data.revert.messageID }),
    ),
  )
  onCleanup(data.on("session.revert.cleared", (event) => dispatch(event.data.sessionID, { type: "revert.cleared" })))
  onCleanup(
    data.on("session.revert.committed", (event) => dispatch(event.data.sessionID, { type: "revert.committed" })),
  )
  onCleanup(
    data.on("session.deleted", (event) => {
      dispatch(event.data.sessionID, { type: "disposed" })
      setSessions((all) => Object.fromEntries(Object.entries(all).filter(([id]) => id !== event.data.sessionID)))
    }),
  )
  onCleanup(() => Object.keys(untrack(sessions)).forEach((sessionID) => dispatch(sessionID, { type: "disposed" })))

  const messageDraft = (message: SessionMessageUser, directory: string) =>
    extractPromptFromMessage(message, {
      directory,
      attachmentName: language.t("common.attachment"),
      sessionTitle: (id) => data.session.get(id)?.title,
    })

  const restore = (
    target: RevertTarget,
    message: SessionMessageUser,
    restored = messageDraft(message, target.directory),
  ) => {
    const context = extractPromptContext(message, { directory: target.directory })

    target.composer.set(restored, promptLength(restored))
    // The restored prompt replaces the draft, so chips from an earlier restore do not ride along.
    target.composer.context.replace([...context.comments, ...context.files])
  }

  const snapshot = (sessionID: string) => {
    const messages = selectSessionUserMessages(data.session.message.list(sessionID))

    return {
      messages,
      inboxIDs: new Set(messages.flatMap((item) => (data.session.input.has(sessionID, item.id) ? [item.id] : []))),
    }
  }

  // Requests act on the routed Session; a kept timeline of another Session cannot start one. The promise settles with
  // the operation it started, so a message's own action stays pending until then.
  const request = async (sessionID: string | undefined, event: (sessionID: string) => SessionRevertEvent) => {
    if (!sessionID || sessionID !== input.session.identity.params.id) return
    const before = runs.get(sessionID)

    if (untrack(sessions)[sessionID]?.status !== "running")
      targets.set(sessionID, { composer: prompt.capture(), directory: location().directory })
    dispatch(sessionID, event(sessionID))
    const started = runs.get(sessionID)

    if (started && started !== before) await started.settled.promise
  }

  function dispatch(sessionID: string, event: SessionRevertEvent) {
    untrack(() => {
      const current = sessions()[sessionID] ?? createSessionRevertState()
      const next = transitionSessionRevert(current, event)

      if (next.state !== current) setSessions((all) => ({ ...all, [sessionID]: next.state }))
      next.effects.forEach((effect) => perform(sessionID, effect))

      if (next.state.status === "idle") targets.delete(sessionID)
    })
  }

  function perform(sessionID: string, effect: SessionRevertEffect) {
    if (effect.type === "operation.run") return run(sessionID, effect.attempt, effect.operation)

    if (effect.type === "operation.abort") return stop(sessionID)

    if (effect.type === "draft.restoreMessage") {
      const target = targets.get(sessionID)

      if (target) restore(target, effect.message, effect.prompt)

      return
    }

    if (effect.type === "draft.restoreSnapshot") {
      const target = targets.get(sessionID)

      if (!target) return
      target.composer.set(effect.draft.prompt, effect.draft.cursor ?? promptLength(effect.draft.prompt))
      target.composer.context.replace([...effect.draft.context])

      return
    }

    // The cursor belongs to the routed Session's timeline, so a Session settling in the background leaves it alone.
    if (effect.type === "cursor.select") {
      if (input.session.identity.params.id === sessionID) input.setActiveMessage(effect.messageID)

      return
    }

    // Rewinding also puts the files back, so offer the way out right where it happened.
    if (effect.type === "toast.showRewound") {
      rewound = {
        sessionID,
        id: showToast({
          title: language.t("session.rewind.toast.title"),
          actions: [
            {
              label: language.t("session.rewind.toast.undo"),
              onClick: () => dispatch(sessionID, { type: "toast.undo", attempt: effect.attempt }),
            },
          ],
        }),
      }

      return
    }

    // Toasts with the same title share one slot, so only dismiss it while it is still this Session's.
    if (effect.type === "toast.dismiss") {
      if (rewound?.sessionID !== sessionID) return
      toaster.dismiss(rewound.id)
      rewound = undefined

      return
    }

    showToast({ title: language.t("common.requestFailed"), description: effect.error })
  }

  function run(sessionID: string, attempt: number, operation: SessionRevertOperation) {
    stop(sessionID)
    const target = targets.get(sessionID)

    // A request captures the target before it dispatches, and a restored rewind keeps it for its Undo.
    if (!target) return dispatch(sessionID, { type: "operation.failed", attempt })

    const active: Run = {
      controller: new AbortController(),
      timer: setTimeout(() => dispatch(sessionID, { type: "operation.timed-out", attempt }), REVERT_TIMEOUT_MS),
      settled: Promise.withResolvers<void>(),
    }

    runs.set(sessionID, active)
    // Every outcome settles in the machine, which drops a result whose attempt is no longer current.
    void execute(sessionID, attempt, operation, target, active.controller.signal)
      .then(
        (event) => dispatch(sessionID, event),
        (cause: unknown) =>
          dispatch(sessionID, {
            type: "operation.failed",
            attempt,
            error: cause instanceof Error ? cause.message : String(cause),
          }),
      )
      .finally(() => {
        if (runs.get(sessionID) === active) stop(sessionID)
      })
  }

  function stop(sessionID: string) {
    const active = runs.get(sessionID)

    if (!active) return
    runs.delete(sessionID)
    clearTimeout(active.timer)
    active.controller.abort()
    active.settled.resolve()
  }

  async function execute(
    sessionID: string,
    attempt: number,
    operation: SessionRevertOperation,
    target: RevertTarget,
    signal: AbortSignal,
  ): Promise<SessionRevertEvent> {
    if (operation.type === "withdraw") {
      // The cancel releases the prompt's blob refs and sweeps blobs nothing else references, so the draft takes
      // local copies of its media first; if they cannot load, the prompt stays queued.
      const restored = await pinPromptMedia(messageDraft(operation.message, target.directory))
      signal.throwIfAborted()
      await server.api.session.inbox.cancel({ sessionID, inboxID: operation.message.id }, { signal })

      return { type: "withdraw.succeeded", attempt, prompt: restored, ...snapshot(sessionID) }
    }

    if (operation.type === "rewind") {
      // Interrupt acknowledges before the execution settles, and staging a busy Session fails. The local status can
      // lag the server either way, so always settle first; both are idle no-ops. Like the TUI, stop at the first
      // failure instead of waiting on work that was never interrupted.
      await server.api.session.interrupt({ sessionID }, { signal })
      await server.api.experimental.session.wait({ sessionID }, { signal })
      await server.api.session.revert.stage({ sessionID, messageID: operation.message.id }, { signal })

      // Like the TUI, pending inputs are left alone: the revert hides them, committing it drops them, and redo
      // delivers them.
      return {
        type: "rewind.succeeded",
        attempt,
        draft: {
          prompt: clonePrompt(target.composer.current()),
          cursor: target.composer.cursor(),
          context: target.composer.context.items().map((item) => ({ ...item })),
        },
        ...snapshot(sessionID),
      }
    }

    // Like the TUI, redo restores every reverted message at once and leaves the composer alone.
    if (operation.type === "redo") {
      await server.api.session.revert.clear({ sessionID }, { signal })

      return { type: "redo.succeeded", attempt, ...snapshot(sessionID) }
    }

    await (operation.prior
      ? server.api.session.revert.stage({ sessionID, messageID: operation.prior }, { signal })
      : server.api.session.revert.clear({ sessionID }, { signal }))

    return { type: "undo-rewind.succeeded", attempt, ...snapshot(sessionID) }
  }

  return {
    to: (messageID: string, sessionID = input.session.identity.params.id) =>
      request(sessionID, (id) => ({
        type: "rewind.to",
        messageID,
        revertMessageID: data.session.get(id)?.revert?.messageID,
        ...snapshot(id),
      })),
    undo: () =>
      request(input.session.identity.params.id, (id) => ({
        type: "undo.requested",
        revertMessageID: data.session.get(id)?.revert?.messageID,
        ...snapshot(id),
      })),
    redo: () =>
      request(input.session.identity.params.id, (id) => ({
        type: "redo.requested",
        revertMessageID: data.session.get(id)?.revert?.messageID,
      })),
    /** Puts a sent prompt back in the composer without rewinding the Session. */
    recall: (message: SessionMessageUser) =>
      restore({ composer: prompt.capture(), directory: location().directory }, message),
    canUndo: () => !!input.session.identity.params.id && view().canUndo,
    canRedo: () => !!input.session.identity.params.id && view().canRedo,
  }
}

type RevertTarget = {
  composer: ReturnType<ReturnType<typeof useComposerState>["capture"]>
  directory: string
}

type Run = {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  settled: PromiseWithResolvers<void>
}

export type SessionRevert = ReturnType<typeof createSessionRevert>
