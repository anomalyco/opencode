import { Bus } from "../bus"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { Session } from "."
import { SessionStatus } from "./status"
import { MessageV2 } from "./message-v2"

export namespace BackgroundTask {
  const log = Log.create({ service: "background-task" })
  const MAX_TIMEOUT = 15 * 60 * 1000

  export interface Info {
    id: string
    childSessionID: string
    parentSessionID: string
    parentAgent: string
    description: string
    agent: string
    status: "running" | "complete" | "error" | "timeout"
    startedAt: number
    completedAt?: number
    result?: string
    error?: string
  }

  const state = Instance.state(() => {
    const tasks = new Map<string, Info>()
    const notified = new Set<string>()
    return { tasks, notified }
  })

  export function register(info: Info) {
    const s = state()
    s.tasks.set(info.id, info)
    log.info("registered", {
      id: info.id,
      child: info.childSessionID,
      parent: info.parentSessionID,
      agent: info.agent,
    })

    // Subscribe to session idle events for completion detection
    Bus.subscribe(SessionStatus.Event.Idle, async (event) => {
      if (event.properties.sessionID !== info.childSessionID) return
      if (info.status !== "running") return
      await complete(info.id)
    })

    // Timeout safety net
    setTimeout(async () => {
      if (info.status !== "running") return
      log.warn("timeout", { id: info.id, child: info.childSessionID })
      info.status = "timeout"
      info.completedAt = Date.now()
      info.error = `Timed out after ${MAX_TIMEOUT / 1000}s`
      await notify(info, formatTimeout(info))
    }, MAX_TIMEOUT)
  }

  async function complete(id: string) {
    const s = state()
    const info = s.tasks.get(id)
    if (!info) return
    if (s.notified.has(id)) return
    s.notified.add(id)

    log.info("completing", { id, child: info.childSessionID })

    try {
      const messages = await Session.messages({
        sessionID: info.childSessionID,
      })
      const text = extractLastAssistantText(messages)

      info.status = "complete"
      info.completedAt = Date.now()
      info.result = text || "(No output produced)"

      await notify(info, formatCompleted(info))
    } catch (e) {
      info.status = "error"
      info.completedAt = Date.now()
      info.error = e instanceof Error ? e.message : String(e)
      log.error("completion failed", { id, error: info.error })
      await notify(info, formatError(info))
    }
  }

  async function notify(info: Info, message: string) {
    try {
      // Dynamically import to avoid circular dependency
      const { SessionPrompt } = await import("./prompt")
      // Fire a notification into the parent session (no await on the loop).
      // Mark the text part as synthetic so the frontend hides the user bubble
      // (prevents a duplicate user turn from appearing in the chat UI).
      SessionPrompt.prompt({
        sessionID: info.parentSessionID,
        agent: info.parentAgent,
        parts: [{ type: "text", text: message, synthetic: true }],
      })
      log.info("notified parent", {
        id: info.id,
        parent: info.parentSessionID,
      })
    } catch (e) {
      log.error("failed to notify parent", {
        id: info.id,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  function extractLastAssistantText(messages: MessageV2.WithParts[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]!
      if (msg.info.role !== "assistant") continue
      const parts = msg.parts
        .filter((p): p is MessageV2.TextPart => p.type === "text" && !!p.text)
        .map((p) => p.text)
        .join("\n")
      if (parts.length > 0) return parts
    }
    return ""
  }

  function duration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remaining = seconds % 60
    return `${minutes}m ${remaining}s`
  }

  function formatCompleted(info: Info): string {
    const elapsed = duration((info.completedAt ?? Date.now()) - info.startedAt)
    const preview =
      info.result && info.result.length > 1500
        ? info.result.slice(0, 1500) + `\n\n[...truncated — use task(task_id="${info.childSessionID}") to resume and read full output]`
        : info.result ?? ""
    return [
      "<task_completed>",
      `task_id: ${info.childSessionID}`,
      `Description: ${info.description}`,
      `Agent: ${info.agent}`,
      `Duration: ${elapsed}`,
      "",
      "Result:",
      preview,
      "</task_completed>",
      "",
      `A background task just completed. Review the result above and inform the user. Use task(task_id="${info.childSessionID}") to resume the session if you need more details.`,
    ].join("\n")
  }

  function formatTimeout(info: Info): string {
    return [
      "<task_timeout>",
      `task_id: ${info.childSessionID}`,
      `Description: ${info.description}`,
      `Agent: ${info.agent}`,
      `Error: Timed out after ${MAX_TIMEOUT / 1000}s`,
      "</task_timeout>",
      "",
      `A background task timed out. Inform the user. You can try resuming it with task(task_id="${info.childSessionID}").`,
    ].join("\n")
  }

  function formatError(info: Info): string {
    return [
      "<task_error>",
      `task_id: ${info.childSessionID}`,
      `Description: ${info.description}`,
      `Agent: ${info.agent}`,
      `Error: ${info.error}`,
      "</task_error>",
      "",
      `A background task failed. Inform the user of the error.`,
    ].join("\n")
  }

  export function get(id: string): Info | undefined {
    return state().tasks.get(id)
  }

  export function list(parentSessionID: string): Info[] {
    return Array.from(state().tasks.values()).filter(
      (t) => t.parentSessionID === parentSessionID,
    )
  }

  export function compactionContext(parentSessionID: string): string | undefined {
    const tasks = list(parentSessionID)
    if (tasks.length === 0) return undefined

    const running = tasks.filter((t) => t.status === "running")
    const completed = tasks.filter((t) => t.status !== "running")
    const sections: string[] = ["<background_tasks>"]

    if (running.length > 0) {
      sections.push("## Running Background Tasks")
      for (const t of running) {
        const elapsed = duration(Date.now() - t.startedAt)
        sections.push(`- task_id: ${t.childSessionID} | "${t.description}" | ${t.agent} | running for ${elapsed}`)
      }
      sections.push("")
      sections.push("> Do NOT poll. You will receive a <task_completed> notification when these finish.")
    }

    if (completed.length > 0) {
      sections.push("## Completed Background Tasks")
      for (const t of completed) {
        const label = t.status === "complete" ? "COMPLETE" : t.status === "timeout" ? "TIMEOUT" : "ERROR"
        sections.push(`- task_id: ${t.childSessionID} | "${t.description}" | ${t.agent} | ${label}`)
        if (t.result) {
          const preview = t.result.length > 200 ? t.result.slice(0, 200) + "..." : t.result
          sections.push(`  Result preview: ${preview}`)
        }
      }
      sections.push("")
      sections.push('> Use task(task_id="...") to resume and get full results.')
    }

    sections.push("</background_tasks>")
    return sections.join("\n")
  }
}
