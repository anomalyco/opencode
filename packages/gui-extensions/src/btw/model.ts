import { batch, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import type { MountedSession, SetupContext } from "../sdk"
import type Btw from "./index"

const instructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

/** One-shot side questions per session, one tab each, stored until the tab closes. */
export function createBtw(ctx: SetupContext<typeof Btw>) {
  const controllers = new Map<string, AbortController>()
  const [requests, setRequests] = createStore<{ pending: string[] }>({ pending: [] })
  const saved = (session: MountedSession) => ctx.stores.chats(session)

  const stop = (id: string) => {
    controllers.get(id)?.abort()
    controllers.delete(id)
    setRequests("pending", (list) => list.filter((item) => item !== id))
  }

  // In-flight questions keep running when the user leaves their session and answer into its store; only a reload,
  // closing the question's tab or disposing the extension abandons one, which leaves it retryable.
  onCleanup(() => Array.from(controllers.keys()).forEach(stop))

  const entry = (session: MountedSession, id: string) => saved(session).value?.chats.find((item) => item.id === id)
  const pending = (id: string) => requests.pending.includes(id)

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

  // Takes the question rather than reading it back, because a new chat's write may still wait for the store to load.
  const generate = (session: MountedSession, id: string, question: string) => {
    if (pending(id)) return

    const store = saved(session)
    const controller = new AbortController()
    const started = Date.now()
    const current = selection(session)
    controllers.set(id, controller)
    setRequests("pending", (list) => [...list, id])

    return (
      session.server.client.session
        .generate(
          { sessionID: session.id, prompt: [instructions, question].join("\n\n") },
          { signal: controller.signal },
        )
        .then((result) => {
          if (ctx.signal.aborted || controller.signal.aborted) return
          const duration = Math.max(0, Date.now() - started)

          store.update((draft) => {
            const chat = draft.chats.find((item) => item.id === id)

            if (!chat) return
            chat.answer = result.text.trim()
            chat.duration = duration

            if (current.agent) chat.agent = current.agent

            if (current.model) chat.model = current.model
          })
        })
        // A missing answer is the retry state; no transient error flag is stored.
        .catch(() => undefined)
        .finally(() => {
          if (controllers.get(id) === controller) stop(id)
        })
    )
  }

  const ask = (value?: string) => {
    const question = value?.trim()

    if (!question) {
      showToast({ title: ctx.t("question.required") })

      return
    }

    const session = ctx.sessions.current()

    if (!session?.id) return

    const id = crypto.randomUUID()
    const created = Date.now()
    const current = selection(session)

    // Desktop storage loads asynchronously. A write before load queues and lands in the same batch that marks the
    // store ready, and the panel keeps a tab hidden until then, so the chat and its tab need not wait. The session's
    // store lives while its tab stays open, so leaving the session first still records the chat.
    batch(() => {
      saved(session).update((draft) => {
        draft.chats.push({
          id,
          question,
          created,
          agent: current.agent,
          model: current.model,
        })
      })
      ctx.layout.open(`${ctx.id}:${id}`, session, { tab: "select" })
    })
    void generate(session, id, question)
  }

  return {
    ask,
    saved,
    pending,
    entry,
    question: (session: MountedSession, id: string) => entry(session, id)?.question,
    answer: (session: MountedSession, id: string) => entry(session, id)?.answer,
    error: (session: MountedSession, id: string) => {
      const item = entry(session, id)

      return !!item && item.answer === undefined && !pending(id)
    },
    retry: (session: MountedSession, id: string) => {
      const question = entry(session, id)?.question

      if (question) void generate(session, id, question)
    },
    /** Closing a tab forgets its question and answer. */
    remove: (session: MountedSession, id: string) => {
      stop(id)
      saved(session).update((draft) => {
        draft.chats = draft.chats.filter((item) => item.id !== id)
      })
    },
  }
}

export type BtwModel = ReturnType<typeof createBtw>
