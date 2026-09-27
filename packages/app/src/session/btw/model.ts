import { createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useCommand } from "@/shell/commands/command"
import { showToast } from "@/shell/notifications/toast"
import { SESSION_BTW_TAB } from "@/session/helpers"
import type { SessionModel } from "../model"

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

export function createSessionBtw(session: SessionModel) {
  const command = useCommand()
  const language = useLanguage()
  const server = useServerSDK()
  const [states, setStates] = createStore<Record<string, typeof empty>>({})
  const requests = new Map<string, number>()
  const controllers = new Map<string, AbortController>()
  const state = () => states[session.identity.sessionKey()] ?? empty

  createEffect(() => {
    const key = session.identity.sessionKey()
    onCleanup(() => {
      const controller = controllers.get(key)
      if (!controller) return
      controller.abort()
      controllers.delete(key)
      if (states[key]?.pending) setStates(key, { pending: false, error: true })
    })
  })

  const open = () => {
    session.layout.view().reviewPanel.open()
    const tabs = session.layout.tabs()
    if (tabs.active() !== SESSION_BTW_TAB) tabs.open(SESSION_BTW_TAB)
  }
  const ask = (value?: string) => {
    const question = value?.trim()
    if (!question) {
      showToast({ title: language.t("session.btw.questionRequired") })
      return
    }
    open()
    const sessionID = session.identity.sessionID()
    if (!sessionID) return

    const key = session.identity.sessionKey()
    const request = (requests.get(key) ?? 0) + 1
    requests.set(key, request)
    controllers.get(key)?.abort()
    const controller = new AbortController()
    controllers.set(key, controller)
    const owner = session.ownership.capture()
    setStates(key, { question, answer: "", error: false, pending: true })
    return server.api.session
      .generate(
        {
          sessionID,
          prompt: [instructions, question].join("\n\n"),
        },
        { signal: controller.signal },
      )
      .then((result) => {
        owner.run(() => {
          if (requests.get(key) !== request) return
          setStates(key, { answer: result.text.trim(), pending: false })
        })
      })
      .catch(() => {
        owner.run(() => {
          if (controller.signal.aborted || requests.get(key) !== request) return
          setStates(key, { error: true, pending: false })
        })
      })
      .finally(() => {
        if (controllers.get(key) === controller) controllers.delete(key)
      })
  }

  command.register("session.btw", () => [
    {
      id: "session.btw",
      title: language.t("command.session.btw"),
      description: language.t("command.session.btw.description"),
      category: language.t("command.category.session"),
      slash: "btw",
      slashArguments: true,
      hidden: true,
      disabled: !session.isDesktop(),
      onSelect: (_source, input) => ask(input),
    },
  ])

  return {
    answer: () => state().answer,
    error: () => state().error,
    pending: () => state().pending,
    question: () => state().question,
    retry: () => ask(state().question),
  }
}

export type SessionBtwModel = ReturnType<typeof createSessionBtw>
