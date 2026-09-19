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

export function createSessionBtw(session: SessionModel) {
  const command = useCommand()
  const language = useLanguage()
  const server = useServerSDK()
  const [state, setState] = createStore({
    question: "",
    answer: "",
    error: "",
    pending: false,
    request: 0,
  })

  const open = () => {
    session.layout.view().reviewPanel.open()
    session.layout.tabs().open(SESSION_BTW_TAB)
    session.layout.tabs().setActive(SESSION_BTW_TAB)
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

    const request = state.request + 1
    const owner = session.ownership.capture()
    setState({ question, answer: "", error: "", pending: true, request })
    void server.api.session
      .generate({
        sessionID,
        prompt: [instructions, question].join("\n\n"),
      })
      .then((result) => {
        owner.run(() => {
          if (state.request !== request) return
          setState({ answer: result.text.trim(), pending: false })
        })
      })
      .catch(() => {
        owner.run(() => {
          if (state.request !== request) return
          setState({ error: language.t("session.btw.error"), pending: false })
        })
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
      disabled: !session.isDesktop(),
      onSelect: (_source, input) => ask(input),
    },
  ])

  return {
    answer: () => state.answer,
    error: () => state.error,
    pending: () => state.pending,
    question: () => state.question,
    retry: () => ask(state.question),
  }
}

export type SessionBtwModel = ReturnType<typeof createSessionBtw>
