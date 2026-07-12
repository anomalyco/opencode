import type { OpenCodeEvent } from "@opencode-ai/client"
import type { TuiAttentionSoundName, TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:notifications"

type SessionError = Extract<OpenCodeEvent, { type: "session.error" }>["data"]["error"]

function notify(
  api: TuiPluginApi,
  sessionID: string | undefined,
  message: string,
  sound: TuiAttentionSoundName,
  title?: string,
) {
  const session = sessionID ? api.state.session.get(sessionID) : undefined
  const isSubagent = session?.parentID !== undefined
  void api.attention.notify({
    title: title ?? session?.title,
    message,
    notification: isSubagent ? false : { when: "blurred" },
    sound: { name: sound, when: "always" },
  })
}

function sessionErrorMessage(error: SessionError) {
  if (error?.name === "MessageAbortedError") return "Session aborted"
  const data = error?.data
  if (data && typeof data === "object" && "message" in data && data.message === "SSE read timed out") {
    return "Model stopped responding"
  }
  return "Session error"
}

const tui: TuiPlugin = async (api) => {
  const errored = new Set<string>()
  const terminal = new Set<string>()
  const forms = new Set<string>()
  const questions = new Set<string>()
  const permissions = new Set<string>()

  api.event.on("form.created", (event) => {
    if (forms.has(event.data.form.id)) return
    forms.add(event.data.form.id)
    notify(
      api,
      event.data.form.sessionID,
      "Input needs response",
      "question",
      event.data.form.title,
    )
  })

  api.event.on("form.replied", (event) => {
    forms.delete(event.data.id)
  })

  api.event.on("form.cancelled", (event) => {
    forms.delete(event.data.id)
  })

  api.event.on("question.asked", (event) => {
    if (questions.has(event.data.id)) return
    questions.add(event.data.id)
    notify(api, event.data.sessionID, "Question needs input", "question")
  })

  api.event.on("question.replied", (event) => {
    questions.delete(event.data.requestID)
  })

  api.event.on("question.rejected", (event) => {
    questions.delete(event.data.requestID)
  })

  api.event.on("permission.asked", (event) => {
    if (permissions.has(event.data.id)) return
    permissions.add(event.data.id)
    notify(api, event.data.sessionID, "Permission needs input", "permission")
  })

  api.event.on("permission.replied", (event) => {
    permissions.delete(event.data.requestID)
  })

  const started = (sessionID: string) => {
    errored.delete(sessionID)
    terminal.delete(sessionID)
  }

  const ended = (sessionID: string) => {
    if (terminal.has(sessionID)) return
    terminal.add(sessionID)
    if (errored.has(sessionID)) {
      errored.delete(sessionID)
      return
    }

    const session = api.state.session.get(sessionID)
    notify(api, sessionID, "Session done", session?.parentID ? "subagent_done" : "done")
  }

  api.event.on("session.execution.started", (event) => started(event.data.sessionID))
  api.event.on("session.execution.succeeded", (event) => ended(event.data.sessionID))
  api.event.on("session.execution.interrupted", (event) => ended(event.data.sessionID))
  api.event.on("session.execution.failed", (event) => {
    const sessionID = event.data.sessionID
    if (errored.has(sessionID)) {
      ended(sessionID)
      return
    }
    errored.add(sessionID)
    notify(api, sessionID, event.data.error.message, "error")
    ended(sessionID)
  })

  api.event.on("session.error", (event) => {
    const sessionID = event.data.sessionID
    if (!sessionID) return
    if (api.state.session.status(sessionID)?.type !== "busy") return
    if (errored.has(sessionID)) return
    errored.add(sessionID)
    notify(api, sessionID, sessionErrorMessage(event.data.error), "error")
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
