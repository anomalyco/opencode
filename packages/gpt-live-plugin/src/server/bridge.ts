import type { Plugin } from "@opencode/plugin"

import type { TaskStatus } from "../shared/rpc"
import { clip, speakable } from "./context"
import type { LiveEvent, Sideband } from "./live"
import type { CallLog } from "./log"

type Context = Plugin.Context

export interface BridgeEvents {
  transcript(role: "user" | "assistant", text: string, final: boolean): void
  task(taskID: string, text: string, status: TaskStatus, detail?: string): void
  activity(scope: "voice" | "main", busy: boolean, label?: string): void
  closed(reason: string): void
  error(message: string): void
  /** The user asked (by voice) to hang up. */
  end(reason: string): void
  /** A finished conversation turn, for persistence across calls. */
  turn?(role: "user" | "assistant", text: string): void
}

interface Task {
  id: string
  text: string
  inboxID?: string
  status: TaskStatus
}

const TOOL_LABELS: Record<string, string> = {
  read: "reading files",
  write: "writing a file",
  edit: "editing code",
  apply_patch: "editing code",
  bash: "running a command",
  shell: "running a command",
  grep: "searching the code",
  glob: "looking for files",
  list: "browsing files",
  webfetch: "reading a web page",
  websearch: "searching the web",
  task: "working with a subagent",
  subagent: "working with a subagent",
  todowrite: "updating its plan",
  skill: "loading a skill",
  patch: "editing code",
  gptlive_main_send: "handing work to Shuvcode",
  gptlive_main_status: "checking on Shuvcode",
  gptlive_main_read: "reading the session",
  gptlive_main_stop: "stopping Shuvcode",
  gptlive_main_permissions: "checking permissions",
  gptlive_main_permission_reply: "answering a permission",
  gptlive_end_call: "ending the call",
}

export function toolLabel(name: string) {
  const key = name.toLowerCase()
  if (TOOL_LABELS[key]) return TOOL_LABELS[key]
  const suffix = key.split(/[_.]/).pop() ?? key
  return TOOL_LABELS[suffix] ?? `using ${name.replaceAll("_", " ")}`
}

/**
 * Connects one GPT-Live call to two OpenCode sessions:
 * - the voice session, which receives everything GPT-Live delegates and whose agent
 *   answers conversational questions or hands real work over with the plugin tools;
 * - the main session the call was started from, which only ever receives explicit tasks.
 */
export class Bridge {
  private readonly tasks = new Map<string, Task>()
  private readonly voiceInbox = new Map<string, string>()
  private readonly abort = new AbortController()
  private currentDelegation: string | undefined
  private voiceText = ""
  private voiceDelegated = false
  private mainBusy = false
  private mainLabel: string | undefined
  private mainText = ""
  private cancelRequested = false
  private closed = false
  private ending = false
  private taskCounter = 0
  /** Finished conversation turns since the last hand-off to the voice agent. */
  private turns: { role: "user" | "assistant"; text: string }[] = []
  /** Coding-session updates the voice agent has not seen yet. */
  private updates: string[] = []
  private introduced = false

  constructor(
    private readonly ctx: Context,
    readonly mainSessionID: string,
    readonly voiceSessionID: string,
    private readonly sideband: Sideband,
    private readonly events: BridgeEvents,
    private readonly log?: CallLog,
    private readonly call = 1,
  ) {
    void this.watchSessions()
  }

  handle(event: LiveEvent) {
    switch (event.kind) {
      case "transcript":
        this.events.transcript(event.role, event.text, event.final)
        if (event.final && event.text.trim()) {
          this.turns.push({ role: event.role, text: event.text.trim() })
          if (this.turns.length > 40) this.turns = this.turns.slice(-40)
          this.log?.write({ type: "turn", role: event.role, text: event.text.trim() })
          this.events.turn?.(event.role, event.text.trim())
        }
        return
      case "delegation":
        void this.toVoice(event.id, event.text).catch((error) =>
          this.events.error(`Could not reach the voice agent: ${String(error)}`),
        )
        return
      case "closed":
        this.events.closed(event.reason ?? "closed")
        return
      case "error":
        this.events.error(event.message)
        return
    }
  }

  private async toVoice(delegationID: string, raw: string) {
    const request = raw.trim()
    if (!request) return
    this.log?.write({ type: "handoff", delegationID, request, turns: this.turns, updates: this.updates })
    const text = handoff(request, this.turns, this.updates, this.introduced ? undefined : this.call)
    this.introduced = true
    this.turns = []
    this.updates = []
    const entry = await this.ctx.session.prompt({
      sessionID: this.voiceSessionID as never,
      text,
      delivery: "queue",
      metadata: { gptLive: { delegationID } },
    })
    const inboxID = (entry as { id?: string }).id
    if (inboxID) this.voiceInbox.set(inboxID, delegationID)
  }

  /** Tool: send a task or message to the main session. */
  async send(raw: string, delivery: "queue" | "steer" = "queue"): Promise<string> {
    const text = raw.trim()
    if (!text) throw new Error("text is empty; write the brief you want to send")
    this.log?.write({ type: "task", delivery, text })
    const id = `task_${++this.taskCounter}`
    const record: Task = { id, text, status: "queued" }
    this.tasks.set(id, record)
    this.events.task(id, text, "queued")
    const entry = await this.ctx.session.prompt({
      sessionID: this.mainSessionID as never,
      text,
      delivery,
      metadata: { gptLive: { voiceSessionID: this.voiceSessionID, taskID: id } },
    })
    record.inboxID = (entry as { id?: string }).id
    if (delivery === "steer" && this.mainBusy)
      return "Delivered to the main session's current work as a steering message. The outcome will be announced when it finishes."
    return this.mainBusy
      ? "Queued in the main session. It is busy with earlier work, so this starts next. The result will be announced when it is done."
      : "Sent to the main session, which has started on it. The result will be announced when it is done."
  }

  /** Tool: recent main-session conversation, including which tools were used. */
  async read(limit = 8): Promise<string> {
    const messages = (await this.ctx.session.context({ sessionID: this.mainSessionID as never })) as readonly Record<
      string,
      unknown
    >[]
    const lines: string[] = []
    for (const message of messages) {
      if (message.type === "user" && typeof message.text === "string") {
        lines.push(`User: ${clip(message.text.trim(), 500)}`)
      } else if (message.type === "assistant" && Array.isArray(message.content)) {
        const parts = message.content as Record<string, unknown>[]
        const tools = parts.filter((part) => part.type === "tool").map((part) => String(part.name))
        const text = parts
          .filter((part) => part.type === "text" && typeof part.text === "string")
          .map((part) => part.text as string)
          .join("\n")
          .trim()
        if (tools.length) lines.push(`Agent used tools: ${[...new Set(tools)].join(", ")}`)
        if (text) lines.push(`Agent: ${clip(speakable(text, 1_500), 1_500)}`)
      }
    }
    const recent = lines.slice(-Math.max(1, Math.min(limit, 30)) * 2)
    return recent.length ? recent.join("\n") : "The main session has no messages yet."
  }

  /** Tool: pending permission requests in the main session. */
  async permissions(): Promise<string> {
    const requests = (await this.ctx.permission
      .list({ sessionID: this.mainSessionID as never })
      .catch(() => [])) as readonly { id: string; action: string; resources: readonly string[]; message?: string }[]
    if (!requests.length) return "The main session has no pending permission requests."
    return requests
      .map(
        (request) =>
          `- id ${request.id}: wants to ${request.action} ${request.resources.join(", ")}${request.message ? ` (${request.message})` : ""}`,
      )
      .join("\n")
  }

  /** Tool: answer a pending permission request. */
  async replyPermission(requestID: string, decision: "once" | "always" | "reject", message?: string) {
    await this.ctx.permission.reply({
      sessionID: this.mainSessionID as never,
      requestID: requestID as never,
      decision,
      ...(message ? { message } : {}),
    })
    return decision === "reject" ? "Rejected the request." : `Allowed the request (${decision}).`
  }

  /** Tool: describe what the main session is doing. */
  status(): string {
    const queued = [...this.tasks.values()].filter((task) => task.status === "queued")
    const running = [...this.tasks.values()].find((task) => task.status === "running")
    const lines = [
      this.mainBusy
        ? `The main session is working${running ? ` on: ${clip(running.text, 200)}` : " on something the user typed"}.`
        : "The main session is idle.",
      this.mainBusy && this.mainLabel ? `Right now it is ${this.mainLabel}.` : undefined,
      queued.length ? `Queued tasks: ${queued.map((task) => clip(task.text, 80)).join("; ")}.` : undefined,
      !this.mainBusy && this.mainText ? `Its last reply was: ${clip(speakable(this.mainText), 600)}` : undefined,
    ]
    return lines.filter(Boolean).join("\n")
  }

  /** Tool: interrupt the main session. */
  async cancel(): Promise<string> {
    this.cancelRequested = true
    const result = await this.ctx.session
      .interrupt({ sessionID: this.mainSessionID as never, resume: false })
      .catch(() => undefined)
    for (const task of this.tasks.values()) {
      if (task.status === "queued" || task.status === "running") this.setStatus(task, "cancelled")
    }
    return (result as { interrupted?: boolean } | undefined)?.interrupted
      ? "The main session stopped its current work."
      : "The main session was not running anything."
  }

  private setStatus(task: Task, status: TaskStatus, detail?: string) {
    task.status = status
    this.events.task(task.id, task.text, status, detail)
  }

  private async watchSessions() {
    try {
      for await (const event of this.ctx.event.subscribe({ signal: this.abort.signal })) {
        const data = (event as { data?: Record<string, unknown> }).data
        if (!data) continue
        if (data.sessionID === this.voiceSessionID) this.onVoiceEvent(event.type, data)
        else if (data.sessionID === this.mainSessionID) this.onMainEvent(event.type, data)
      }
    } catch (error) {
      if (!this.abort.signal.aborted) this.events.error(`Lost the Shuvcode event stream: ${String(error)}`)
    }
  }

  private onVoiceEvent(type: string, data: Record<string, unknown>) {
    switch (type) {
      case "session.inbox.delivered": {
        const delegation = this.voiceInbox.get(String(data.inboxID))
        if (delegation) {
          this.voiceInbox.delete(String(data.inboxID))
          this.currentDelegation = delegation
        }
        return
      }
      case "session.execution.started":
        this.voiceText = ""
        this.voiceDelegated = false
        this.events.activity("voice", true, "thinking")
        return
      case "session.tool.input.started":
        if (typeof data.name !== "string") return
        if (data.name === "gptlive_main_send") this.voiceDelegated = true
        this.events.activity("voice", true, toolLabel(data.name))
        return
      case "session.text.ended":
        if (typeof data.text === "string" && data.text.trim()) this.voiceText = data.text
        return
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted": {
        this.events.activity("voice", false)
        const text = speakable(this.voiceText, 1_200)
        const failed = type === "session.execution.failed"
        const message = failed
          ? `The voice agent hit an error: ${clip((data.error as { message?: string })?.message ?? "unknown", 200)}`
          : text
        // After handing work off, GPT-Live has already acknowledged; the result is spoken later.
        const channel = (this.voiceDelegated || !this.currentDelegation) && !failed ? "commentary" : "speakable"
        if (message) this.log?.write({ type: "voice-reply", channel, text: message })
        if (message) this.sideband.append(message, channel, this.currentDelegation)
        this.currentDelegation = undefined
        this.voiceText = ""
        return
      }
    }
  }

  private onMainEvent(type: string, data: Record<string, unknown>) {
    switch (type) {
      case "permission.asked": {
        const resources = Array.isArray(data.resources) ? data.resources.join(", ") : ""
        const spoken = `The coding session needs permission to ${String(data.action ?? "continue")}${resources ? ` ${clip(resources, 160)}` : ""}. Ask the user whether to allow it once, always, or reject it.`
        this.sideband.append(spoken, "speakable")
        this.notifyVoice(`${spoken} Request id: ${String(data.id)}.`)
        return
      }
      case "session.inbox.delivered": {
        const task = [...this.tasks.values()].find((item) => item.inboxID === data.inboxID)
        if (task && task.status === "queued") this.setStatus(task, "running")
        return
      }
      case "session.execution.started":
        this.mainBusy = true
        this.mainText = ""
        this.mainLabel = "thinking"
        this.cancelRequested = false
        this.events.activity("main", true, this.mainLabel)
        return
      case "session.tool.input.started":
        if (typeof data.name !== "string") return
        this.mainLabel = toolLabel(data.name)
        this.events.activity("main", true, this.mainLabel)
        return
      case "session.text.ended":
        if (typeof data.text === "string" && data.text.trim()) this.mainText = data.text
        return
      case "session.execution.succeeded":
        this.finishMain("done")
        return
      case "session.execution.failed":
        this.finishMain("failed", (data.error as { message?: string } | undefined)?.message)
        return
      case "session.execution.interrupted":
        this.finishMain("cancelled")
        return
    }
  }

  private finishMain(outcome: "done" | "failed" | "cancelled", error?: string) {
    this.mainBusy = false
    this.mainLabel = undefined
    this.events.activity("main", false)
    const running = [...this.tasks.values()].filter((task) => task.status === "running")
    if (running.length === 0) return
    const result = speakable(this.mainText)
    for (const task of running) {
      let spoken: string | undefined
      if (outcome === "done") {
        this.setStatus(task, "done")
        spoken = result
          ? `Finished the task "${clip(task.text, 120)}". Outcome: ${result}`
          : `Finished the task "${clip(task.text, 120)}".`
      } else if (outcome === "failed") {
        this.setStatus(task, "failed", error)
        spoken = `The task "${clip(task.text, 120)}" failed: ${clip(error ?? "unknown error", 300)}`
      } else {
        this.setStatus(task, "cancelled")
        if (!this.cancelRequested) spoken = `Work on "${clip(task.text, 120)}" was stopped.`
      }
      if (!spoken) continue
      // Speak it now, and keep the voice agent's memory in sync without starting a turn.
      this.sideband.append(spoken, "speakable")
      this.notifyVoice(spoken)
    }
  }

  /** Queue a coding-session update for the voice agent's next hand-off (no extra turn). */
  private notifyVoice(text: string) {
    this.log?.write({ type: "update", text })
    this.updates.push(text)
    if (this.updates.length > 10) this.updates = this.updates.slice(-10)
  }

  /** Tool: hang up after the goodbye has been spoken. */
  endCall(): string {
    if (this.ending) return "The call is already ending."
    this.ending = true
    this.log?.write({ type: "end-requested" })
    setTimeout(() => this.events.end("Ended by voice"), 4_500)
    return "The call ends in a few seconds. Reply with a very short goodbye and nothing else."
  }

  /** Lets the user type a message straight to the voice layer. */
  say(text: string) {
    this.sideband.append(`The user typed: ${text}`, "speakable")
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
    this.sideband.close()
  }
}

function escape(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

/**
 * Builds the message the voice agent receives for one hand-off: the conversation since
 * the previous hand-off (turns GPT-Live answered itself included), coding-session updates
 * it has not seen, and the request as the voice model understood it.
 */
export function handoff(
  request: string,
  turns: readonly { role: "user" | "assistant"; text: string }[],
  updates: readonly string[],
  call?: number,
) {
  const parts: string[] = []
  if (call !== undefined) {
    parts.push(
      call > 1
        ? `<call_started number="${call}">A new voice call started. Earlier calls in this session are above; the user may refer back to them.</call_started>`
        : `<call_started number="1">The first voice call in this session started.</call_started>`,
    )
  }
  if (turns.length) {
    const lines = turns.map((turn) => `${turn.role === "user" ? "user" : "you"}: ${escape(clip(turn.text, 1_200))}`)
    parts.push(`<conversation_since_last_message>\n${lines.join("\n")}\n</conversation_since_last_message>`)
  }
  if (updates.length) {
    parts.push(
      `<coding_session_updates>\n${updates.map((update) => `- ${escape(update)}`).join("\n")}\n</coding_session_updates>`,
    )
  }
  parts.push(`<request>${escape(request)}</request>`)
  return parts.join("\n")
}
