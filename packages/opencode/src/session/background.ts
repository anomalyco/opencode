import { Bus } from "@/bus"
import { Session } from "./index"
import { SessionStatus } from "./status"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { SessionID, MessageID, PartID } from "./schema"
import { SessionPrompt } from "./prompt"

export namespace SessionBackground {
  const log = Log.create({ service: "session.background" })

  const state = Instance.state(
    () => {
      const wakeable = new Set<SessionID>()
      const unsubscribes = [
        Bus.subscribe(Session.Event.BackgroundTaskCompleted, async (event) => {
          const sessionID = event.properties.sessionID
          const task = event.properties.task

          await updateTaskMessage(sessionID, task).then(() => {
            state().wakeable.add(sessionID)
          }).catch((err) => {
            log.error("failed to update background task session message", { sessionID, error: err })
          })
          await wake(sessionID).catch((err) => {
            log.error("failed to wake for finished tasks", { sessionID, error: err })
          })
        }),
        Bus.subscribe(SessionStatus.Event.Status, async (event) => {
          const sessionID = event.properties.sessionID

          await wake(sessionID).catch((err) => {
            log.error("failed to wake for finished tasks", { sessionID, error: err })
          })
        }),
      ]
      return { wakeable, unsubscribes }
    },
    async (current) => {
      for (const unsubscribe of current.unsubscribes) {
        unsubscribe()
      }
    },
  )

  export function init() {
    return state()
  }

  async function wake(sessionID: SessionID) {
    const session = await Session.get(sessionID).catch(() => {
      log.warn("session not found, skipping wake", { sessionID })
      return
    })
    if (!session) {
      return
    }

    const s = state()
    if (!s.wakeable.has(sessionID)) {
      return
    }

    const status = SessionStatus.get(sessionID)
    if (status.type !== "idle") {
      return
    }

    s.wakeable.delete(sessionID)
    SessionStatus.set(sessionID, { type: "busy" })
    await SessionPrompt.loop({ sessionID })
  }

  async function updateTaskMessage(sessionID: SessionID, task: Session.BackgroundTask) {
    const msgID = MessageID.ascending()
    const output = [`Session ID: ${task.sessionID}`, "", "<task_result>", task.result, "</task_result>"].join("\n")
    const text =
      task.status === "success"
        ? `Background task '${task.description}' completed.\n${output}`
        : `Background task '${task.description}' failed: ${task.result}`

    await Session.updateMessage({
      id: msgID,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: task.agent,
      model: task.model,
    })
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: msgID,
      sessionID,
      type: "text",
      synthetic: true,
      text,
    })
  }
}
