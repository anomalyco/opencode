import type { Event } from "@opencode-ai/sdk/v2"
import type { TuiAttentionSoundName, TuiEventMetadata, TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:notifications"

type SessionError = Extract<Event, { type: "session.error" }>["properties"]["error"]

function matchesSession(api: TuiPluginApi, sessionID: string, metadata: TuiEventMetadata) {
  const session = api.state.session.get(sessionID)
  return session?.directory === metadata.directory && session.workspaceID === metadata.workspace
}

function notify(api: TuiPluginApi, sessionID: string | undefined, message: string, sound: TuiAttentionSoundName) {
  const session = sessionID ? api.state.session.get(sessionID) : undefined
  if (!session) return
  const isSubagent = session?.parentID !== undefined
  void api.attention.notify({
    title: session?.title,
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
  const active = new Set<string>()
  const errored = new Set<string>()
  const questions = new Set<string>()
  const permissions = new Set<string>()

  api.event.on("question.asked", (event, metadata) => {
    if (!matchesSession(api, event.properties.sessionID, metadata)) return
    if (!api.state.session.question(event.properties.sessionID).some((item) => item.id === event.properties.id)) return
    if (questions.has(event.properties.id)) return
    questions.add(event.properties.id)
    notify(api, event.properties.sessionID, "Question needs input", "question")
  })

  api.event.on("question.replied", (event, metadata) => {
    if (!matchesSession(api, event.properties.sessionID, metadata)) return
    questions.delete(event.properties.requestID)
  })

  api.event.on("question.rejected", (event, metadata) => {
    if (!matchesSession(api, event.properties.sessionID, metadata)) return
    questions.delete(event.properties.requestID)
  })

  api.event.on("permission.asked", (event, metadata) => {
    if (!matchesSession(api, event.properties.sessionID, metadata)) return
    if (!api.state.session.permission(event.properties.sessionID).some((item) => item.id === event.properties.id))
      return
    if (permissions.has(event.properties.id)) return
    permissions.add(event.properties.id)
    notify(api, event.properties.sessionID, "Permission needs input", "permission")
  })

  api.event.on("permission.replied", (event, metadata) => {
    if (!matchesSession(api, event.properties.sessionID, metadata)) return
    permissions.delete(event.properties.requestID)
  })

  api.event.on("session.status", (event, metadata) => {
    const sessionID = event.properties.sessionID
    if (!matchesSession(api, sessionID, metadata)) return
    if (event.properties.status.type === "busy" || event.properties.status.type === "retry") {
      active.add(sessionID)
      errored.delete(sessionID)
      return
    }

    if (event.properties.status.type !== "idle") return
    if (!active.has(sessionID)) return
    active.delete(sessionID)

    if (errored.has(sessionID)) {
      errored.delete(sessionID)
      return
    }

    const session = api.state.session.get(sessionID)
    notify(api, sessionID, "Session done", session?.parentID ? "subagent_done" : "done")
  })

  api.event.on("session.error", (event, metadata) => {
    const sessionID = event.properties.sessionID
    if (!sessionID) return
    if (!matchesSession(api, sessionID, metadata)) return
    if (!active.has(sessionID)) return
    errored.add(sessionID)
    notify(api, sessionID, sessionErrorMessage(event.properties.error), "error")
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
