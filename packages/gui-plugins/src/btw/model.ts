import { batch, createSignal, onCleanup, untrack } from "solid-js"
import { showToast } from "@opencode/ui/toast"
import { uuid } from "@opencode/util/uuid"
import {
  readSideChatAnswer,
  sharedThreadText,
  sideChatDescription,
  sideChatPrompt,
  sideNoteText,
  sideQuestionPrompt,
} from "@opencode/util/side-chat"
import { createLatest, type MountedSession, type SetupContext } from "@opencode/plugin/gui"
import type Btw from "./index"
import {
  btwChatView,
  btwTabView,
  btwThreadTurns,
  createBtwState,
  transitionBtw,
  type BtwEffect,
  type BtwEvent,
} from "./machine"

/** One-shot side questions per session, one tab each, stored until the tab closes. */
export function createBtw(ctx: SetupContext<typeof Btw>) {
  const [state, setState] = createSignal(createBtwState())

  // The side_chat feature flag as the current session's server resolves it; until it answers, /btw stays one-shot.
  const flags = createLatest(
    () => {
      const session = ctx.sessions.current()

      return session && { server: session.server, directory: session.directory }
    },
    (target, signal) => target.server.client.experimental.config.flags({ location: { directory: target.directory } }, { signal }),
  )

  const sideChat = () => flags.latest?.side_chat.enabled === true
  // Driver handles only: the machine decides which attempt runs, these end its request and timeout.
  const inFlight = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const saved = (session: MountedSession) => {
    const store = ctx.stores.chats(session)

    return store.ready() ? (store.value?.chats ?? []) : undefined
  }

  // Effects act on `session`, the session of the action or request that caused the event.
  const dispatch = (event: BtwEvent, session?: MountedSession) => {
    const previous = untrack(state)
    const result = transitionBtw(previous, event)

    batch(() => {
      if (result.state !== previous) setState(result.state)
      result.effects.forEach((effect) => run(effect, session))
    })
  }

  const run = (effect: BtwEffect, session: MountedSession | undefined) => {
    if (effect.type === "abort") {
      const handle = inFlight.get(effect.attempt)
      inFlight.delete(effect.attempt)

      if (!handle) return
      clearTimeout(handle.timer)
      handle.controller.abort()

      return
    }

    // SAFETY: only `disposed`, `sessions.pruned` and request results without an answer dispatch without a session,
    // and the machine answers those with `abort` alone.
    if (!session) return
    const store = ctx.stores.chats(session)

    if (effect.type === "persist-question") {
      // Desktop storage loads asynchronously; a write before load queues and lands once it loads, while the machine
      // already shows the chat. The session's store lives while its tab stays open.
      store.update((draft) => {
        draft.chats.push({
          id: effect.id,
          thread: effect.thread,
          question: effect.question,
          created: effect.created,
          agent: effect.agent,
          model: effect.model,
        })
      })

      return
    }

    if (effect.type === "open-tab") {
      ctx.layout.open(`${ctx.id}:${effect.id}`, session, { tab: "select" })

      return
    }

    if (effect.type === "persist-answer") {
      store.update((draft) => {
        const chat = draft.chats.find((item) => item.id === effect.id)

        if (!chat) return
        chat.answer = effect.answer
        chat.duration = effect.duration

        if (effect.agent) chat.agent = effect.agent

        if (effect.model) chat.model = effect.model
      })

      return
    }

    if (effect.type === "delete-chat") {
      // Closing a thread's tab forgets its follow-ups too.
      store.update((draft) => {
        draft.chats = draft.chats.filter((item) => item.id !== effect.id && item.thread !== effect.id)
      })

      return
    }

    generate(session, effect)
  }

  // In-flight questions keep running when the user leaves their session and answer into its store; only a reload,
  // closing the question's tab or session, or disposing the plugin abandons one, which leaves it retryable.
  const generate = (session: MountedSession, effect: Extract<BtwEffect, { type: "generate" }>) => {
    const key = session.key
    const result = { sessionKey: key, id: effect.id, attempt: effect.attempt }
    const controller = new AbortController()

    inFlight.set(effect.attempt, {
      controller,
      timer: setTimeout(() => dispatch({ type: "generate.timed-out", ...result }), effect.timeout),
    })

    session.server.client.session
      .generate(
        {
          sessionID: session.id,
          prompt: sideChat()
            ? sideChatPrompt(earlier(session, effect), effect.question)
            : sideQuestionPrompt(effect.question),
        },
        { signal: AbortSignal.any([ctx.signal, controller.signal]) },
      )
      .then(
        (reply) => {
          if (ctx.signal.aborted) return

          if (!sideChat()) {
            dispatch({ type: "generate.succeeded", ...result, text: reply.text, now: Date.now() }, session)

            return
          }

          const read = readSideChatAnswer(reply.text)
          const text = read.answer || (read.note ? ctx.t("note.only") : "")

          dispatch({ type: "generate.succeeded", ...result, text, now: Date.now() }, session)

          if (read.note) relay(session, effect.id, read.note, effect.question)
        },
        (cause) => {
          if (ctx.signal.aborted) return
          const message = cause instanceof Error ? cause.message : String(cause)
          dispatch({ type: "generate.failed", ...result, message })
        },
      )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  // Passes a note the side model wrote to the agent, the same way a shared thread reaches it, and keeps its inbox item
  // so the user can take it back before the agent reads it.
  const relay = (session: MountedSession, id: string, note: string, question: string) => {
    const store = ctx.stores.chats(session)

    const mark = (value: { inboxID?: string; failed?: boolean }) =>
      store.update((draft) => {
        const chat = draft.chats.find((item) => item.id === id)

        if (chat) chat.note = { text: note, ...value }
      })

    mark({})
    session.server.client.session
      .synthetic({
        sessionID: session.id,
        text: sideNoteText(note, question),
        description: sideChatDescription(note),
        metadata: { source: "btw", turnID: id, relayed: true },
        delivery: "steer",
        resume: false,
      })
      .then(
        (item) => {
          if (!ctx.signal.aborted) mark({ inboxID: item.id })
        },
        () => {
          if (!ctx.signal.aborted) mark({ failed: true })
        },
      )
  }

  // The answered turns asked before this one in its thread, which a follow-up's answer builds on.
  const earlier = (session: MountedSession, effect: { readonly id: string; readonly thread?: string }) => {
    if (!effect.thread) return []
    const current = untrack(state)
    const stored = saved(session)
    const ids = btwThreadTurns(current, stored, session.key, effect.thread)

    return ids.slice(0, ids.indexOf(effect.id)).flatMap((id) => {
      const view = btwChatView(current, stored, session.key, id)

      return view.phase === "answered" ? [{ question: view.question, answer: view.answer }] : []
    })
  }

  const selection = (session: MountedSession) => {
    const info = session.id ? session.server.data.session.get(session.id) : undefined
    const messages = session.id ? session.server.data.session.message.list(session.id) : []

    const lastAgent = messages.findLast(
      (item) => item.type === "assistant" || item.type === "agent-switched",
    )

    const lastModel = messages.findLast(
      (item) => item.type === "assistant" || item.type === "model-switched",
    )

    const agent = info?.agent ?? (lastAgent?.type === "assistant" || lastAgent?.type === "agent-switched" ? lastAgent.agent : undefined)
    const model = info?.model ?? (lastModel?.type === "assistant" || lastModel?.type === "model-switched" ? lastModel.model : undefined)

    return {
      agent,
      model: model ? { providerID: model.providerID, id: model.id, variant: model.variant } : undefined,
    }
  }

  const ask = (value?: string) => {
    const question = value?.trim()

    if (!question) {
      showToast({ title: ctx.t("question.required") })

      return
    }

    const session = ctx.sessions.current()

    if (!session?.id) return

    dispatch(
      { type: "chat.asked", sessionKey: session.key, id: uuid(), question, created: Date.now(), ...selection(session) },
      session,
    )
  }

  const turns = (session: MountedSession, id: string) => btwThreadTurns(state(), saved(session), session.key, id)

  return {
    ask,
    turns,
    sideChat,
    /** The note a turn passed to the agent, and whether it still waits in the session's inbox. */
    note: (session: MountedSession, id: string) => {
      const note = saved(session)?.find((item) => item.id === id)?.note

      if (!note) return undefined

      const waiting =
        !!note.inboxID &&
        !note.undone &&
        session.server.data.session.pending.list(session.id).some((item) => item.id === note.inboxID)

      return { ...note, waiting }
    },
    /** Takes back a turn's note while the agent has not read it yet. */
    undo: async (session: MountedSession, id: string) => {
      const inboxID = saved(session)?.find((item) => item.id === id)?.note?.inboxID

      if (!inboxID) return
      await session.server.client.session.inbox.cancel({ sessionID: session.id, inboxID })

      if (ctx.signal.aborted) return
      ctx.stores.chats(session).update((draft) => {
        const chat = draft.chats.find((item) => item.id === id)

        if (chat?.note) chat.note.undone = true
      })
    },
    /** Asks a follow-up in the thread whose first question is `id`. */
    follow: (session: MountedSession, id: string, value: string) => {
      const question = value.trim()

      if (!question || !session.id) return
      dispatch(
        {
          type: "chat.asked",
          sessionKey: session.key,
          id: uuid(),
          thread: id,
          question,
          created: Date.now(),
          ...selection(session),
        },
        session,
      )
    },
    /** How many answered turns of the thread the agent has not seen yet. */
    unshared: (session: MountedSession, id: string) => {
      const shared = saved(session)?.find((item) => item.id === id)?.shared ?? 0

      return turns(session, id)
        .slice(shared)
        .filter((turn) => btwChatView(state(), saved(session), session.key, turn).phase === "answered").length
    },
    shared: (session: MountedSession, id: string) => saved(session)?.find((item) => item.id === id)?.shared ?? 0,
    /**
     * Adds the thread's answered turns the agent has not seen to the session as one synthetic message. It steers, so a
     * working agent reads it at its next step; an idle session keeps it pending for the next prompt rather than waking
     * the agent to react to it.
     */
    share: async (session: MountedSession, id: string) => {
      const ids = turns(session, id)
      const views = ids.map((turn) => btwChatView(state(), saved(session), session.key, turn))
      const upTo = views.findLastIndex((view) => view.phase === "answered") + 1
      const from = saved(session)?.find((item) => item.id === id)?.shared ?? 0

      const answered = views
        .slice(from, upTo)
        .flatMap((view) => (view.phase === "answered" ? [{ question: view.question, answer: view.answer }] : []))

      if (answered.length === 0 || !session.id) return "empty" as const
      const busy = session.server.data.session.status(session.id) === "running"
      const title = views[0]?.phase === "loading" || views[0]?.phase === "missing" ? "" : (views[0]?.question ?? "")

      await session.server.client.session.synthetic({
        sessionID: session.id,
        text: sharedThreadText(answered),
        description: sideChatDescription(title),
        metadata: { source: "btw", threadID: id, turns: upTo },
        delivery: "steer",
        resume: false,
      })

      if (ctx.signal.aborted) return "empty" as const
      ctx.stores.chats(session).update((draft) => {
        const root = draft.chats.find((item) => item.id === id)

        if (root) root.shared = upTo
      })

      return busy ? ("steered" as const) : ("pending" as const)
    },
    tab: (session: MountedSession, id: string) => btwTabView(state(), saved(session), session.key, id),
    view: (session: MountedSession, id: string) => btwChatView(state(), saved(session), session.key, id),
    retry: (session: MountedSession, id: string) => {
      dispatch(
        {
          type: "chat.retried",
          sessionKey: session.key,
          id,
          now: Date.now(),
          saved: saved(session)?.find((item) => item.id === id),
          ...selection(session),
        },
        session,
      )
    },
    /** Closing a tab forgets its question and answer. */
    remove: (session: MountedSession, id: string) =>
      batch(() =>
        turns(session, id)
          .toReversed()
          .forEach((turn) => dispatch({ type: "chat.removed", sessionKey: session.key, id: turn }, session)),
      ),
    /** Ends the requests of sessions whose shell tab closed and forgets their chats. */
    prune: (keep: ReadonlySet<string>) => dispatch({ type: "sessions.pruned", keep }),
  }
}

export type BtwModel = ReturnType<typeof createBtw>

