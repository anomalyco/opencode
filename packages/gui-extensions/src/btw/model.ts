import { batch, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { showToast } from "@opencode/ui/toast"
import { createKeyed, type MountedSession, type SetupContext } from "../sdk"
import type Btw from "./index"

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
export function createBtw(ctx: SetupContext<typeof Btw>) {
  const sessions = ctx.sessions
  const layout = ctx.layout
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

  // Leaving a session abandons its in-flight question; the same session moving to another directory does not.
  createKeyed(
    () => sessions.current()?.key,
    (key) => onCleanup(() => stop(key)),
  )
  onCleanup(() => Array.from(controllers.keys()).forEach(stop))

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

  const state = (session: MountedSession) => states[session.key]

  return {
    ask,
    has: (session: MountedSession) => !!state(session),
    answer: (session: MountedSession) => (state(session) ?? empty).answer,
    error: (session: MountedSession) => (state(session) ?? empty).error,
    pending: (session: MountedSession) => (state(session) ?? empty).pending,
    question: (session: MountedSession) => (state(session) ?? empty).question,
    retry: (session: MountedSession) => ask((state(session) ?? empty).question),
  }
}

export type BtwModel = ReturnType<typeof createBtw>
