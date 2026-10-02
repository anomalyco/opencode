import { batch, createEffect, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import { Layout, Sessions, type Context, type SessionView } from "../sdk"

const instructions = [
  "The user is asking a quick side question about the conversation so far.",
  "Answer directly and concisely in markdown from what you already know.",
  "Do not call any tools and do not take any actions.",
].join(" ")

const empty = {
  question: "",
  answer: "",
  error: false,
  pending: false,
}

/** Side questions per session. Window-local: a reload drops them, and with them the tab. */
export function createBtw(ctx: Context) {
  const sessions = ctx.use(Sessions)
  const layout = ctx.use(Layout)
  const [states, setStates] = createStore<Record<string, typeof empty>>({})
  const requests = new Map<string, number>()
  const controllers = new Map<string, AbortController>()

  const stop = (key: string) => {
    const controller = controllers.get(key)
    if (!controller) return
    controller.abort()
    controllers.delete(key)
    if (states[key]?.pending) setStates(key, { pending: false, error: true })
  }

  // Leaving a session abandons its in-flight question.
  createEffect(
    on(
      () => sessions.current()?.key,
      (key) => {
        if (key) onCleanup(() => stop(key))
      },
    ),
  )
  ctx.cleanup(() => Array.from(controllers.keys()).forEach(stop))

  const ask = (value?: string) => {
    const question = value?.trim()
    if (!question) {
      showToast({ title: ctx.t("question.required") })
      return
    }
    const session = sessions.current()
    if (!session?.id) return

    const key = session.key
    const request = (requests.get(key) ?? 0) + 1
    requests.set(key, request)
    controllers.get(key)?.abort()
    const controller = new AbortController()
    controllers.set(key, controller)
    // The tab lists only while its session has a question, and the host drops unlisted transient keys, so
    // record the question in the same batch that opens the tab.
    batch(() => {
      setStates(key, { question, answer: "", error: false, pending: true })
      layout.open(`${ctx.id}:main`, session)
    })
    return session.server.client.session
      .generate(
        {
          sessionID: session.id,
          prompt: [instructions, question].join("\n\n"),
        },
        { signal: controller.signal },
      )
      .then((result) => {
        if (controller.signal.aborted || requests.get(key) !== request) return
        setStates(key, { answer: result.text.trim(), pending: false })
      })
      .catch(() => {
        if (controller.signal.aborted || requests.get(key) !== request) return
        setStates(key, { error: true, pending: false })
      })
      .finally(() => {
        if (controllers.get(key) === controller) controllers.delete(key)
      })
  }

  const state = (session: SessionView) => states[session.key]

  return {
    ask,
    has: (session: SessionView) => !!state(session),
    answer: (session: SessionView) => (state(session) ?? empty).answer,
    error: (session: SessionView) => (state(session) ?? empty).error,
    pending: (session: SessionView) => (state(session) ?? empty).pending,
    question: (session: SessionView) => (state(session) ?? empty).question,
    retry: (session: SessionView) => ask((state(session) ?? empty).question),
  }
}

export type BtwModel = ReturnType<typeof createBtw>
