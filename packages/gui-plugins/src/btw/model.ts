import { batch, createSignal, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import { uuid } from "@opencode/util/uuid"
import type { MountedSession, SetupContext } from "@opencode/plugin/gui"
import type Btw from "./index"
import { btwChatView, btwTabView, createBtwState, transitionBtw, type BtwEffect, type BtwEvent } from "./machine"

const instructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

/** One-shot side questions per session, one tab each, stored until the tab closes. */
export function createBtw(ctx: SetupContext<typeof Btw>) {
  const [state, setState] = createSignal(createBtwState())
  // Driver handles only: the machine decides which attempt runs, these end its request and timeout.
  const inFlight = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  // Tabs whose answer or failure arrived while they were open but not shown, by `${session key}\n${tab id}`.
  const [unread, setUnread] = createStore<Record<string, boolean | undefined>>({})

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

    // SAFETY: only `disposed` and `sessions.pruned` dispatch without a session, and the machine answers those with
    // `abort` alone.
    if (!session) return
    const store = ctx.stores.chats(session)

    if (effect.type === "persist-question") {
      // Desktop storage loads asynchronously; a write before load queues and lands once it loads, while the machine
      // already shows the chat. The session's store lives while its tab stays open.
      store.update((draft) => {
        draft.chats.push({
          id: effect.id,
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
      store.update((draft) => {
        draft.chats = draft.chats.filter((item) => item.id !== effect.id)
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

    // A closed tab or a superseded retry already aborted its attempt, so only a current attempt marks its tab.
    const settle = (event: BtwEvent) => {
      const current = inFlight.has(effect.attempt)
      dispatch(event, session)

      if (current && ctx.layout.state(`${ctx.id}:${effect.id}`, session) !== "visible")
        setUnread(`${key}\n${effect.id}`, true)
    }

    inFlight.set(effect.attempt, {
      controller,
      timer: setTimeout(() => settle({ type: "generate.timed-out", ...result }), effect.timeout),
    })

    session.server.client.session
      .generate(
        { sessionID: session.id, prompt: [instructions, effect.question].join("\n\n") },
        { signal: AbortSignal.any([ctx.signal, controller.signal]) },
      )
      .then(
        (reply) => {
          if (ctx.signal.aborted) return
          settle({ type: "generate.succeeded", ...result, text: reply.text, now: Date.now() })
        },
        (cause) => {
          if (ctx.signal.aborted) return
          const message = cause instanceof Error ? cause.message : String(cause)
          settle({ type: "generate.failed", ...result, message })
        },
      )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

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

  return {
    ask,
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
    /** The tab got its answer or failure while hidden and has not been shown since. */
    unread: (session: MountedSession, id: string) => !!unread[`${session.key}\n${id}`],
    seen: (session: MountedSession, id: string) => setUnread(`${session.key}\n${id}`, undefined),
    /** Closing a tab forgets its question and answer. */
    remove: (session: MountedSession, id: string) => {
      setUnread(`${session.key}\n${id}`, undefined)
      dispatch({ type: "chat.removed", sessionKey: session.key, id }, session)
    },
    /** Ends the requests of sessions whose shell tab closed and forgets their chats. */
    prune: (keep: ReadonlySet<string>) => {
      Object.keys(unread)
        .filter((key) => !keep.has(key.slice(0, key.lastIndexOf("\n"))))
        .forEach((key) => setUnread(key, undefined))
      dispatch({ type: "sessions.pruned", keep })
    },
  }
}

export type BtwModel = ReturnType<typeof createBtw>
