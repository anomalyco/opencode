import { Tool } from "../shared/tool"
import z from "zod"
import { Session } from "../../session"
import { SessionID, MessageID } from "../../session/schema"
import { MessageV2 } from "../../session/message-v2"
import { Agent } from "../../agent/agent"
import { SessionPrompt } from "../../session/prompt"
import { SessionStatus } from "../../session/status"
import { Config } from "../../config/config"
import { ConfigMarkdown } from "../../config/markdown"
import { Permission } from "@/permission"
import { Bus } from "@/bus"
import { NamedError } from "@opencode-ai/shared/util/error"
import { Log } from "@/util/log"
import { Effect } from "effect"
import { blank, seen, zero } from "../shared/shape"
import { TuiEvent } from "@/cli/cmd/tui/event"
import { Storage } from "@/storage/storage"
import { Hash } from "@/util/hash"
import { Instance } from "@/project/instance"
import {
  activeTaskTimeout,
  armTaskTimeout,
  beginTaskTimeoutExpiry,
  clearTaskTimeout,
  timeoutLines,
  timeoutLimitMs,
} from "./timeout-watchdog"

const log = Log.create({ service: "tool.task_async" })
const id = "task_async"
const stalled_ms = 60_000
const Action = z.enum(["start", "resume", "wait", "status", "abort", "message"])
const block = new Map([
  ["translate-agent", "subagent_type=translate-agent is not supported by task_async"],
])
const booted = new Set<string>()
const recovering = new Set<SessionID>()
type WaitWatch = {
  key: string
  ownerSessionID: SessionID
  taskIDs: SessionID[]
  unsubscribe?: () => void
}
type WaitWatchRecord = {
  ownerSessionID: SessionID
  taskIDs: SessionID[]
  createdAt: number
}
type PromptParts = Awaited<ReturnType<typeof SessionPrompt.resolvePromptParts>>
const waitWatches = new Map<string, WaitWatch>()
const waitWatchPrefix = ["task_async_wait"] as const
const DESCRIPTION = `Use this tool to start and manage asynchronous subagent work. It supports six actions: \`start\`, \`message\`, \`resume\`, \`wait\`, \`status\`, and \`abort\`. This tool is truly asynchronous: \`start\`, \`message\`, \`resume\`, and active \`wait\` registrations can return before background work is finished. Completion shows up as a UI notification instead of being delivered back into the caller session, task output remains retrievable later with \`task_async status\` by \`task_id\`, and active \`wait\` registrations are persisted and recovered across process restarts. Prefer \`task_async wait\` over repeated status polling when you need background completion watching for one or more running tasks. Only the actions and subagents allowed by the caller's current permissions are available; the dynamic section below shows that per-agent permission view.

Actions, field rules, and usage:
- \`start\`: create a new async subagent task and return immediately with a \`task_id\`. It accepts only \`action\` (optional and defaults to \`start\`), \`description\`, \`prompt\`, \`subagent_type\`, optional \`timeout_ms\`, and optional \`command\`; do not send \`task_id\`, \`task_ids\`, or \`message\` with \`start\`. This creates a child session owned by the current session and launches the selected subagent in the background. When \`timeout_ms\` is set, expiry shows a UI timeout warning without aborting the task. Use \`start\` only for a brand new task.
- \`message\`: send a follow-up instruction to an existing async task. It accepts only \`action\`, \`task_id\`, \`message\`, optional \`timeout_ms\`, and optional \`command\`. It does not create a new task; it reuses the task's current agent and model context, then continues asynchronously. When a task is stuck in \`retry\` or visibly \`stalled\` with no assistant output, the follow-up restarts that task so the new instruction can take effect promptly. \`timeout_ms\` can renew the timeout watch without aborting the task on expiry. Use \`wait\` to watch the task later, and use \`status\` when you need the stored output by \`task_id\`.
- \`resume\`: continue an existing async task without sending a new message. It accepts only \`action\`, \`task_id\`, optional \`timeout_ms\`, and optional \`command\`. Use this when the same task should continue with no new caller instruction, then let it finish asynchronously. If the task is still running, \`timeout_ms\` renews the timeout watch without aborting the task.
- \`wait\`: arm background completion watching for one or more owned async tasks. It accepts only \`action\`, either \`task_id\` or \`task_ids\`, and optional \`command\`. If every requested task is already idle, it returns a completed summary immediately. Otherwise it returns immediately after registering the watch, persists that watch for restart recovery, and a UI notification appears when all requested tasks are idle. It does not inline the child-session result text, so inspect any finished task later with \`task_async status\` using its \`task_id\`.
- \`status\`: inspect the current state of an existing async task. It accepts only \`action\`, \`task_id\`, and optional \`command\`. It reports task status, title, agent, model, timestamps, retry details when relevant, task-output visibility (\`checkpoint\`, \`pending\`, \`retry\`, \`stalled\`, or \`missing\`), warning versus error context when the latest chunk failed after visible output, the latest visible user and assistant excerpts, and a larger latest assistant result block when available. \`task_id\` must belong to a task_async-owned task. Use it for later result retrieval or explicit point inspection; prefer \`wait\` over repeated polling.
- \`abort\`: stop the task tree rooted at the provided \`task_id\`. It accepts only \`action\`, \`task_id\`, and optional \`command\`. It stops the target task session and its descendant async/task sessions.

- \`resume\`, \`wait\`, \`status\`, \`abort\`, and \`message\` must not include \`description\`, \`prompt\`, or \`subagent_type\`.
- Existing-task actions other than \`message\` must not include \`message\`.
- \`timeout_ms\` is allowed only for \`start\`, \`message\`, and \`resume\`.
- Some callers have additional routing restrictions or companion tools; rely on the dynamic permission view below for caller-specific guidance.`

const desc = z
  .preprocess(blank, z.string().optional())
  .describe("A short (3-5 words) description of the task. Required for action=start")
const prompt = z.preprocess(blank, z.string().optional()).describe("The task prompt to run. Required for action=start")
const msg = z
  .preprocess(blank, z.string().optional())
  .describe("A follow-up message for an existing async task. Required for action=message")
const sub = z.preprocess(blank, z.string().optional()).describe("The subagent type to start. Required for action=start")
const task = z
  .preprocess(blank, z.string().optional())
  .describe("The async task session ID. Required for resume, status, abort, message, and single-task wait actions")
const tasks = z
  .array(z.preprocess(blank, z.string()))
  .optional()
  .describe("One or more async task session IDs. Required for action=wait when task_id is not provided")
const cmd = z.preprocess(blank, z.string().optional()).describe("The command that triggered this task")
const timeout = z
  .preprocess(zero, z.coerce.number().int().positive().max(timeoutLimitMs).optional())
  .describe(
    "Optional timeout in milliseconds for action=start, action=resume, or action=message. Expiry shows a UI timeout warning without aborting the task.",
  )

const parameters = z
  .object({
    action: Action.default("start").describe("Async task action to perform."),
    description: desc,
    prompt,
    subagent_type: sub,
    task_id: task,
    task_ids: tasks,
    message: msg,
    command: cmd,
    timeout_ms: timeout,
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (keys: string[]) => {
      for (const key of keys) {
        if (seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when action=${value.action}`,
        })
      }
    }
    const drop = (keys: string[]) => {
      for (const key of keys) {
        if (!seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is not allowed when action=${value.action}`,
        })
      }
    }

    if (value.action === "start") {
      need(["description", "prompt", "subagent_type"])
      drop(["task_id", "task_ids", "message"])
      const txt = value.subagent_type ? block.get(value.subagent_type) : undefined
      if (txt) {
        ctx.addIssue({
          code: "custom",
          path: ["subagent_type"],
          message: txt,
        })
      }
      return
    }

    if (value.action === "message") {
      need(["task_id", "message"])
      drop(["description", "prompt", "subagent_type", "task_ids"])
      return
    }

    if (value.action === "wait") {
      if (!seen(value.task_id) && !(value.task_ids?.length && value.task_ids.every(seen))) {
        ctx.addIssue({
          code: "custom",
          path: ["task_id"],
          message: "task_id or task_ids is required when action=wait",
        })
      }
      drop(["description", "prompt", "subagent_type", "message"])
      if (seen(value.timeout_ms)) {
        ctx.addIssue({
          code: "custom",
          path: ["timeout_ms"],
          message: "timeout_ms is not allowed when action=wait",
        })
      }
      return
    }

    need(["task_id"])
    drop(["description", "prompt", "subagent_type", "message", "task_ids"])
    if (["status", "abort"].includes(value.action)) drop(["timeout_ms"])
  })

function clip(text?: string, max = 500) {
  if (!text) return ""
  if (text.length <= max) return text
  return text.slice(0, max - 3) + "..."
}

function text(msg?: MessageV2.WithParts) {
  return clip(msg?.parts.findLast((part) => part.type === "text")?.text)
}

function merged(msg?: MessageV2.WithParts) {
  return (
    msg?.parts
      .filter((part): part is MessageV2.TextPart => part.type === "text" && part.ignored !== true)
      .map((part) => part.text)
      .join("") ?? ""
  )
}

function body(msg?: MessageV2.WithParts, max = 4000) {
  return clip(merged(msg), max)
}

type AssistantMessage = MessageV2.WithParts & { info: MessageV2.Assistant }
type UserMessage = MessageV2.WithParts & { info: MessageV2.User }

function lastUser(msgs: MessageV2.WithParts[]) {
  const hit = msgs.findLast((msg) => msg.info.role === "user")
  return hit && hit.info.role === "user" ? (hit as UserMessage) : undefined
}

function err(msg?: MessageV2.Assistant["error"]) {
  if (!msg) return ""
  if ("message" in msg.data && typeof msg.data.message === "string") return msg.data.message
  return msg.name
}

function assistantSnapshot(msg?: AssistantMessage, max = 500) {
  const value = body(msg, max)
  const error = err(msg?.info.error)
  return {
    text: value,
    error,
    visible: !!value || !!error,
  }
}

function snapshots(
  assistant?: AssistantMessage,
  visibleAssistant: AssistantMessage | undefined = assistant,
  max = 500,
) {
  const latest = assistantSnapshot(assistant, max)
  const visible = assistant === visibleAssistant ? latest : assistantSnapshot(visibleAssistant, max)
  return { latest, visible }
}

function issue(input: {
  latest: ReturnType<typeof assistantSnapshot>
  visible: ReturnType<typeof assistantSnapshot>
  error?: unknown
}) {
  const note =
    input.error instanceof Error
      ? input.error.message
      : input.error
        ? String(input.error)
        : input.latest.error || input.visible.error
  if (!note) return
  const warning = !input.error && !!(input.latest.text || input.visible.text)
  return { note, warning }
}

function stale(status: SessionStatus.Info | undefined, session?: Session.Info) {
  if (!status || status.type === "idle" || !session) return false
  return Date.now() - session.time.updated >= stalled_ms
}

function taskOutputState(
  status: SessionStatus.Info | undefined,
  assistant?: AssistantMessage,
  visibleAssistant: AssistantMessage | undefined = assistant,
  session?: Session.Info,
) {
  if (!status) return
  const { latest, visible } = snapshots(assistant, visibleAssistant)
  if (status.type === "retry") return latest.visible || visible.visible ? "checkpoint" : "retry"
  if (status.type !== "idle") {
    if (latest.visible || visible.visible) return "checkpoint"
    return stale(status, session) ? "stalled" : "pending"
  }
  return latest.visible || visible.visible ? undefined : "missing"
}

function resultText(
  status: SessionStatus.Info,
  assistant?: AssistantMessage,
  visibleAssistant: AssistantMessage | undefined = assistant,
  session?: Session.Info,
  max = 4_000,
) {
  const { latest, visible } = snapshots(assistant, visibleAssistant, max)
  if (latest.text) return latest.text
  if (visible.text) return visible.text
  if (latest.error) return latest.error
  if (visible.error) return visible.error
  if (status.type === "retry") {
    return `Task is retrying (attempt ${status.attempt}). ${status.message}`
  }
  if (stale(status, session)) {
    const seconds = Math.max(1, Math.round((Date.now() - session!.time.updated) / 1000))
    return `(task appears stalled; no visible assistant output for about ${seconds}s)`
  }
  return status.type === "idle"
    ? "(no visible assistant output)"
    : "(task is still busy; no visible assistant output yet)"
}

function lastVisibleAssistant(msgs: MessageV2.WithParts[]) {
  const hit = msgs.findLast((msg) => msg.info.role === "assistant" && body(msg as AssistantMessage).trim().length > 0)
  return hit && hit.info.role === "assistant" ? (hit as AssistantMessage) : undefined
}

function lastAssistant(msgs: MessageV2.WithParts[]) {
  const hit = msgs.findLast((msg) => msg.info.role === "assistant")
  return hit && hit.info.role === "assistant" ? (hit as AssistantMessage) : undefined
}

function plain(text: string) {
  return text.replace(/\s+\(@[^)]+ async subagent\)$/, "")
}

function isAsyncTaskTitle(text: string) {
  return / \(@[^)]+ async subagent\)(?: \(stopped\))?$/.test(text)
}

function orphanReason(msgs: MessageV2.WithParts[]) {
  const last = msgs.at(-1)
  if (!last) return
  if (last.info.role === "user") return "latest_user"
  if (last.info.role !== "assistant") return
  if (last.info.finish || last.info.time.completed || last.info.error) return
  return "unfinished_assistant"
}

function hasNestedTaskID(text: string) {
  return /(^|\n)task_id:\s/.test(text)
}

function meta(sessionId: SessionID, model?: { providerID: string; modelID: string }) {
  return { sessionId, model }
}

function normalizeTaskIDs(taskIDs: string[]) {
  return [...new Set(taskIDs.map((taskID) => String(SessionID.make(taskID))))].map((taskID) => SessionID.make(taskID))
}

function waitWatchKey(ownerSessionID: SessionID, taskIDs: SessionID[]) {
  return `${ownerSessionID}:${taskIDs.map(String).sort().join(",")}`
}

function waitWatchStorageKey(ownerSessionID: SessionID, taskIDs: SessionID[]) {
  const sorted = normalizeTaskIDs(taskIDs.map(String)).map(String).sort().join(",")
  return [...waitWatchPrefix, String(ownerSessionID), Hash.fast(sorted)]
}

function summarizeTaskIDs(taskIDs: SessionID[], max = 4) {
  const values = taskIDs.map(String)
  if (values.length <= max) return values.join(", ")
  return `${values.slice(0, max).join(", ")}, ...`
}

async function inspectTask(taskID: SessionID) {
  const [session, status, msgs] = await Promise.all([
    Session.get(taskID),
    SessionStatus.get(taskID),
    Session.messages({ sessionID: taskID }).catch(() => [] as MessageV2.WithParts[]),
  ])
  return {
    session,
    status,
    assistant: lastAssistant(msgs),
    visibleAssistant: lastVisibleAssistant(msgs),
  }
}

async function notify(
  input:
    | {
        kind: "finished" | "failed"
        description: string
        taskID: SessionID
      }
    | {
        kind: "timeout"
        description: string
        taskID: SessionID
        timeoutMs: number
      }
    | {
        kind: "wait_finished"
        taskIDs: SessionID[]
      },
) {
  const title =
    input.kind === "finished"
      ? "Async task finished"
      : input.kind === "failed"
        ? "Async task failed"
        : input.kind === "timeout"
          ? "Async task timeout"
          : "Async wait finished"
  const message =
    input.kind === "timeout"
      ? `${input.description} (task_id: ${input.taskID}) exceeded ${input.timeoutMs}ms. The task is still running; inspect it with task_async status or renew it with timeout_ms.`
      : input.kind === "wait_finished"
        ? `${input.taskIDs.length} watched async task${input.taskIDs.length === 1 ? " is" : "s are"} now idle (task_ids: ${summarizeTaskIDs(input.taskIDs)}). Inspect each with task_async status for stored results.`
        : `${input.description} (task_id: ${input.taskID}). Inspect it with task_async status for the stored result.`
  const variant =
    input.kind === "finished"
      ? "success"
      : input.kind === "failed"
        ? "error"
        : input.kind === "timeout"
          ? "warning"
          : "success"
  await Bus.publish(TuiEvent.ToastShow, {
    title,
    message,
    variant,
  })
}

async function recoverTask(input: {
  task: Session.Info
  parentID: SessionID
  reason: "latest_user" | "unfinished_assistant"
}) {
  const taskID = input.task.id
  if (recovering.has(taskID)) return
  recovering.add(taskID)
  const description = plain(input.task.title)
  log.info("task_async orphan recovery", {
    taskID,
    parentID: input.parentID,
    recovery: "restart",
    reason: input.reason,
    status: "detected",
  })
  clearTaskTimeout(taskID)
  const status = await SessionStatus.get(taskID).catch(() => ({ type: "idle" as const }))
  if (status.type !== "idle") {
    await SessionStatus.set(taskID, { type: "idle" }).catch(() => undefined)
  }
  await SessionPrompt.cancel(taskID).catch(() => undefined)
  log.info("task_async orphan recovery", {
    taskID,
    parentID: input.parentID,
    recovery: "restart",
    reason: input.reason,
    status: "restarting",
  })
  void SessionPrompt.loop({ sessionID: taskID })
    .then(
      async (msg) => {
        clearTaskTimeout(taskID)
        return notify({
          kind: "finished",
          taskID,
          description,
        })
          .then(() => {
            log.info("task_async orphan recovery", {
              taskID,
              parentID: input.parentID,
              recovery: "restart",
              reason: input.reason,
              status: "completed",
            })
          })
          .catch((error) => {
            log.error("task_async recovery delivery failed", {
              taskID,
              sessionID: input.parentID,
              error,
            })
          })
      },
      async (error) => {
        clearTaskTimeout(taskID)
        fail("resume", error, taskID)
        return notify({
          kind: "failed",
          taskID,
          description,
        })
          .then(() => {
            log.info("task_async orphan recovery", {
              taskID,
              parentID: input.parentID,
              recovery: "restart",
              reason: input.reason,
              status: "failed",
            })
          })
          .catch((cause) => {
            log.error("task_async recovery delivery failed", {
              taskID,
              sessionID: input.parentID,
              error: cause,
            })
          })
      },
    )
    .finally(() => {
      recovering.delete(taskID)
    })
}

async function bootTaskOrphans() {
  const sessions = Array.from(Session.list())
  const tasks = sessions.filter((session) => session.parentID && isAsyncTaskTitle(session.title))
  await Promise.all(
    tasks.map(async (task) => {
      const parentID = task.parentID
      if (!parentID) return
      const [msgs, child, parent] = await Promise.all([
        Session.messages({ sessionID: task.id }).catch(() => [] as MessageV2.WithParts[]),
        SessionPrompt.active(task.id).catch(() => false),
        SessionPrompt.active(parentID).catch(() => false),
      ])
      const reason = orphanReason(msgs)
      if (!reason) return
      if (child || parent) {
        log.info("task_async orphan recovery", {
          taskID: task.id,
          parentID,
          recovery: "skip",
          reason,
          status: child ? "child_active" : "parent_active",
        })
        return
      }
      await recoverTask({
        task,
        parentID,
        reason,
      })
    }),
  )
}

async function expireTaskTimeout(taskID: SessionID, token: number) {
  const pending = activeTaskTimeout(taskID, token)
  if (!pending) return

  const inspected = await inspectTask(taskID)
    .then((snapshot) => ({ snapshot }))
    .catch((error) => ({ error }))
  const hit = beginTaskTimeoutExpiry(taskID, token)
  if (!hit) return
  if ("snapshot" in inspected && inspected.snapshot.status.type === "idle") {
    clearTaskTimeout(taskID)
    return
  }

  await notify({
    kind: "timeout",
    taskID,
    description: hit.description,
    timeoutMs: hit.timeoutMs,
  }).catch((error) => {
    log.error("task_async timeout delivery failed", {
      taskID,
      sessionID: hit.starterID,
      error,
    })
  })
}

async function clearPersistedWaitWatchKey(key: string[]) {
  await Storage.remove(key).catch(() => undefined)
}

async function clearPersistedWaitWatch(record: { ownerSessionID: SessionID; taskIDs: SessionID[] }) {
  await clearPersistedWaitWatchKey(waitWatchStorageKey(record.ownerSessionID, record.taskIDs))
}

async function readPersistedWaitWatch(key: string[]) {
  const raw = await Storage.read<{ ownerSessionID?: string; taskIDs?: string[]; createdAt?: number }>(key)
  if (!raw.ownerSessionID || !raw.taskIDs?.length) {
    await clearPersistedWaitWatchKey(key)
    throw new Error(`Invalid persisted task_async wait record: ${key.join("/")}`)
  }
  const ownerSessionID = SessionID.make(raw.ownerSessionID)
  const taskIDs = normalizeTaskIDs(raw.taskIDs)
  if (!taskIDs.length) {
    await clearPersistedWaitWatchKey(key)
    throw new Error(`Invalid persisted task_async wait record: ${key.join("/")}`)
  }
  return {
    ownerSessionID,
    taskIDs,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  }
}

async function armRecoveredWaitWatch(input: { ownerSessionID: SessionID; taskIDs: SessionID[] }) {
  const ids = normalizeTaskIDs(input.taskIDs.map(String))
  const key = waitWatchKey(input.ownerSessionID, ids)
  if (waitWatches.has(key)) return false

  const tracked = new Set(ids.map(String))
  let closed = false
  let unsubscribe: (() => void) | undefined

  const finish = async () => {
    if (closed) return
    closed = true
    unsubscribe?.()
    waitWatches.delete(key)
    await clearPersistedWaitWatch({
      ownerSessionID: input.ownerSessionID,
      taskIDs: ids,
    }).catch(() => undefined)
    await notify({
      kind: "wait_finished",
      taskIDs: ids,
    })
  }

  const failWatch = async (error: unknown) => {
    if (closed) return
    closed = true
    unsubscribe?.()
    waitWatches.delete(key)
    log.error("task_async wait watcher failed", {
      ownerSessionID: input.ownerSessionID,
      taskIDs: ids,
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await clearPersistedWaitWatch({
      ownerSessionID: input.ownerSessionID,
      taskIDs: ids,
    }).catch(() => undefined)
  }

  const settle = async () => {
    const next = await Promise.all(ids.map((taskID) => inspectTask(taskID)))
    if (next.every((item) => item.status.type === "idle")) {
      await finish()
    }
  }

  waitWatches.set(key, {
    key,
    ownerSessionID: input.ownerSessionID,
    taskIDs: ids,
  })

  try {
    unsubscribe = Bus.subscribe(SessionStatus.Event.Status, (event) => {
      const taskID = String(event.properties.sessionID)
      if (!tracked.has(taskID) || event.properties.status.type !== "idle") return
      void settle().catch(failWatch)
    })
  } catch (error) {
    waitWatches.delete(key)
    await clearPersistedWaitWatch({
      ownerSessionID: input.ownerSessionID,
      taskIDs: ids,
    }).catch(() => undefined)
    throw error
  }

  waitWatches.set(key, {
    key,
    ownerSessionID: input.ownerSessionID,
    taskIDs: ids,
    unsubscribe,
  })

  void settle().catch(failWatch)
  return true
}

async function bootWaitWatches() {
  const keys = await Storage.list([...waitWatchPrefix])
  for (const key of keys) {
    const record = await readPersistedWaitWatch(key).catch(async (error) => {
      log.error("task_async wait record cleanup failed", {
        key,
        error,
      })
      return undefined
    })
    if (!record) continue

    await armRecoveredWaitWatch({
      ownerSessionID: record.ownerSessionID,
      taskIDs: record.taskIDs,
    }).catch(async (error) => {
      log.error("task_async wait recovery failed", {
        ownerSessionID: record.ownerSessionID,
        taskIDs: record.taskIDs,
        error,
      })
      await clearPersistedWaitWatch(record).catch(() => undefined)
    })
  }
}

export async function boot() {
  let dir: string
  try {
    dir = Instance.directory
  } catch {
    return
  }
  if (booted.has(dir)) return
  booted.add(dir)
  await bootTaskOrphans()
    .then(() => bootWaitWatches())
    .finally(() => {
      booted.delete(dir)
    })
}

function fail(action: z.infer<typeof Action>, err: unknown, sessionID: SessionID) {
  const error = err instanceof Error ? err : new Error(String(err))
  log.error("task_async failed", { action, sessionID, error })
  void Bus.publish(Session.Event.Error, {
    sessionID,
    error: new NamedError.Unknown({ message: error.message }).toObject(),
  })
}

function needsRestart(
  status: SessionStatus.Info | undefined,
  assistant?: AssistantMessage,
  visibleAssistant: AssistantMessage | undefined = assistant,
  session?: Session.Info,
) {
  if (!status || status.type === "idle") return false
  const { latest, visible } = snapshots(assistant, visibleAssistant)
  if (latest.visible || visible.visible) return false
  return status.type === "retry" || stale(status, session)
}

export const TaskAsyncTool = Tool.defineEffect(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const config = yield* Config.Service
    const storage = yield* Storage.Service
    const sessions = yield* Session.Service
    const expand = (text: string): Promise<PromptParts> =>
      ConfigMarkdown.files(text).length
        ? SessionPrompt.resolvePromptParts(text)
        : Promise.resolve([{ type: "text" as const, text }])

    const persistWaitWatch = Effect.fn("TaskAsyncTool.persistWaitWatch")(function* (record: WaitWatchRecord) {
      yield* storage.write(waitWatchStorageKey(record.ownerSessionID, record.taskIDs), {
        ownerSessionID: String(record.ownerSessionID),
        taskIDs: record.taskIDs.map(String),
        createdAt: record.createdAt,
      })
    })

    const clearPersistedWaitWatchKey = Effect.fn("TaskAsyncTool.clearPersistedWaitWatchKey")(function* (key: string[]) {
      yield* storage.remove(key).pipe(Effect.orElseSucceed(() => undefined))
    })

    const clearPersistedWaitWatch = Effect.fn("TaskAsyncTool.clearPersistedWaitWatch")(function* (record: {
      ownerSessionID: SessionID
      taskIDs: SessionID[]
    }) {
      yield* clearPersistedWaitWatchKey(waitWatchStorageKey(record.ownerSessionID, record.taskIDs))
    })

    const readPersistedWaitWatch = Effect.fn("TaskAsyncTool.readPersistedWaitWatch")(function* (key: string[]) {
      const raw = yield* storage.read<{ ownerSessionID?: string; taskIDs?: string[]; createdAt?: number }>(key)
      if (!raw.ownerSessionID || !raw.taskIDs?.length) {
        yield* clearPersistedWaitWatchKey(key)
        return yield* Effect.fail(new Error(`Invalid persisted task_async wait record: ${key.join("/")}`))
      }
      const ownerSessionID = SessionID.make(raw.ownerSessionID)
      const taskIDs = normalizeTaskIDs(raw.taskIDs)
      if (!taskIDs.length) {
        yield* clearPersistedWaitWatchKey(key)
        return yield* Effect.fail(new Error(`Invalid persisted task_async wait record: ${key.join("/")}`))
      }
      return {
        ownerSessionID,
        taskIDs,
        createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
      }
    })

    const armWaitWatch = Effect.fn("TaskAsyncTool.armWaitWatch")(function* (input: {
      ownerSessionID: SessionID
      taskIDs: SessionID[]
      persist?: boolean
    }) {
      const ids = normalizeTaskIDs(input.taskIDs.map(String))
      const key = waitWatchKey(input.ownerSessionID, ids)
      if (waitWatches.has(key)) return false
      if (input.persist !== false) {
        yield* persistWaitWatch({
          ownerSessionID: input.ownerSessionID,
          taskIDs: ids,
          createdAt: Date.now(),
        })
      }

      yield* Effect.sync(() => {
        const tracked = new Set(ids.map(String))
        let closed = false
        let unsubscribe: (() => void) | undefined

        const finish = async () => {
          if (closed) return
          closed = true
          unsubscribe?.()
          waitWatches.delete(key)
          await Effect.runPromise(
            clearPersistedWaitWatch({
              ownerSessionID: input.ownerSessionID,
              taskIDs: ids,
            }),
          ).catch(() => undefined)
          await notify({
            kind: "wait_finished",
            taskIDs: ids,
          })
        }

        const failWatch = (error: unknown) => {
          if (closed) return
          closed = true
          unsubscribe?.()
          waitWatches.delete(key)
          log.error("task_async wait watcher failed", {
            ownerSessionID: input.ownerSessionID,
            taskIDs: ids,
            error: error instanceof Error ? error : new Error(String(error)),
          })
        }

        const settle = async () => {
          try {
            const next = await Promise.all(ids.map((taskID) => inspectTask(taskID)))
            if (next.every((item) => item.status.type === "idle")) {
              await finish()
            }
          } catch (error) {
            await Effect.runPromise(
              clearPersistedWaitWatch({
                ownerSessionID: input.ownerSessionID,
                taskIDs: ids,
              }),
            ).catch(() => undefined)
            throw error
          }
        }

        waitWatches.set(key, {
          key,
          ownerSessionID: input.ownerSessionID,
          taskIDs: ids,
        })

        try {
          unsubscribe = Bus.subscribe(SessionStatus.Event.Status, (event) => {
            const taskID = String(event.properties.sessionID)
            if (!tracked.has(taskID) || event.properties.status.type !== "idle") return
            void settle().catch(failWatch)
          })
        } catch (error) {
          waitWatches.delete(key)
          void Effect.runPromise(
            clearPersistedWaitWatch({
              ownerSessionID: input.ownerSessionID,
              taskIDs: ids,
            }),
          ).catch(() => undefined)
          throw error
        }

        waitWatches.set(key, {
          key,
          ownerSessionID: input.ownerSessionID,
          taskIDs: ids,
          unsubscribe,
        })

        void settle().catch(failWatch)
      })

      return true
    })

    const run = Effect.fn("TaskAsyncTool.execute")(function* (params: z.infer<typeof parameters>, ctx: Tool.Context) {
      const cfg = yield* config.get()
      const action = params.action

      if (!ctx.extra?.bypassAgentCheck) {
        const patterns = action === "start" ? [params.subagent_type!, action] : [action]
        const always = action === "start" ? [params.subagent_type!, action] : [action]
        yield* Effect.promise(() =>
          ctx.ask({
            permission: id,
            patterns,
            always,
            metadata: {
              action,
              description: action === "start" ? params.description : undefined,
              subagent_type: action === "start" ? params.subagent_type : undefined,
              task_id: action === "start" ? undefined : params.task_id,
            },
          }),
        )
      }

      const load = Effect.fn("TaskAsyncTool.load")(function* (taskID: string) {
        const sessionID = SessionID.make(taskID)
        const [session, status, msgs] = yield* Effect.all(
          [
            sessions.get(sessionID),
            Effect.promise(() => SessionStatus.get(sessionID)),
            sessions.messages({ sessionID }),
          ],
          { concurrency: "unbounded" },
        )

        const owns = yield* Effect.fn("TaskAsyncTool.owns")(function* () {
          let id = session.parentID
          const seen = new Set<string>()
          while (id && !seen.has(id)) {
            if (id === ctx.sessionID) return true
            seen.add(id)
            const pid = id
            const parent = yield* Effect.promise(() => Session.get(pid)).pipe(Effect.orElseSucceed(() => undefined))
            id = parent?.parentID
          }
          return false
        })()

        if (!owns) {
          return yield* Effect.fail(
            new Error(`Task ${taskID} is not owned by the current session and cannot be managed here`),
          )
        }
        const user = msgs.findLast(
          (item): item is MessageV2.WithParts & { info: MessageV2.User } => item.info.role === "user",
        )
        const assistant = msgs.findLast(
          (item): item is MessageV2.WithParts & { info: MessageV2.Assistant } => item.info.role === "assistant",
        )
        const visibleAssistant = lastVisibleAssistant(msgs)
        return { session, status, msgs, user, assistant, visibleAssistant }
      })

      const inspectWaitTasks = Effect.fn("TaskAsyncTool.inspectWaitTasks")(function* (taskIDs: string[]) {
        const ids = normalizeTaskIDs(taskIDs)
        return yield* Effect.promise(() => Promise.all(ids.map((taskID) => Effect.runPromise(load(taskID)))))
      })

      const launch = Effect.fn("TaskAsyncTool.launch")(function* (input: {
        taskID: SessionID
        description: string
        timeoutMs?: number
        clearTimeout?: boolean
        run: () => Promise<MessageV2.WithParts>
      }) {
        const timer = yield* Effect.sync(() => {
          if (input.timeoutMs) {
            return armTaskTimeout({
              taskID: input.taskID,
              starterID: ctx.sessionID,
              starterAgent: ctx.agent,
              description: input.description,
              timeoutMs: input.timeoutMs,
              onExpire: (taskID, token) => {
                void expireTaskTimeout(taskID, token)
              },
            })
          }
          if (input.clearTimeout) clearTaskTimeout(input.taskID)
        })
        yield* Effect.sync(() => {
          void input.run().then(
            async (msg) => {
              clearTaskTimeout(input.taskID)
              return notify({
                kind: "finished",
                taskID: input.taskID,
                description: input.description,
              }).catch((error) => {
                log.error("task_async notification failed", { taskID: input.taskID, sessionID: ctx.sessionID, error })
              })
            },
            async (error) => {
              clearTaskTimeout(input.taskID)
              fail(action, error, input.taskID)
              return notify({
                kind: "failed",
                taskID: input.taskID,
                description: input.description,
              }).catch((cause) => {
                log.error("task_async notification failed", {
                  taskID: input.taskID,
                  sessionID: ctx.sessionID,
                  error: cause,
                })
              })
            },
          )
        })
        return timer
      })

      const resume = Effect.fn("TaskAsyncTool.resume")(function* (taskID: string) {
        const info = yield* load(taskID)
        ctx.metadata({ title: info.session.title, metadata: meta(info.session.id) })

        if (info.status.type !== "idle") {
          const timer = params.timeout_ms
            ? yield* Effect.sync(() =>
                armTaskTimeout({
                  taskID: info.session.id,
                  starterID: ctx.sessionID,
                  starterAgent: ctx.agent,
                  description: plain(info.session.title),
                  timeoutMs: params.timeout_ms!,
                  onExpire: (taskID, token) => {
                    void expireTaskTimeout(taskID, token)
                  },
                }),
              )
            : undefined
          return {
            title: info.session.title,
            metadata: meta(info.session.id),
            output: [
              `task_id: ${info.session.id}`,
              `status: already_running`,
              `session_status: ${info.status.type}`,
              ...(timer ? timeoutLines(info.session.id) : []),
            ].join("\n"),
          }
        }

        const timer = yield* launch({
          taskID: info.session.id,
          description: plain(info.session.title),
          timeoutMs: params.timeout_ms,
          clearTimeout: !params.timeout_ms,
          run: () => SessionPrompt.loop({ sessionID: info.session.id }),
        })

        return {
          title: info.session.title,
          metadata: meta(info.session.id),
          output: [
            `task_id: ${info.session.id}`,
            `status: resumed`,
            `completion: ui_notification`,
            `result_access: use task_async wait or task_async status with this task_id`,
            ...(timer ? timeoutLines(info.session.id) : []),
          ].join("\n"),
        }
      })

      if (action === "wait") {
        const taskIDs = [...(params.task_id ? [params.task_id] : []), ...(params.task_ids ?? [])]
        const info = yield* inspectWaitTasks(taskIDs)
        const title = info.length === 1 ? info[0]!.session.title : `Wait for ${info.length} async tasks`
        if (info.length === 1) {
          ctx.metadata({ title, metadata: meta(info[0]!.session.id) })
        } else {
          ctx.metadata({ title })
        }

        if (info.every((item) => item.status.type === "idle")) {
          return {
            title,
            metadata: info.length === 1 ? meta(info[0]!.session.id) : {},
            output: [
              `status: completed`,
              `tasks_tracked: ${info.length}`,
              `result_access: inspect each task with task_async status using its task_id`,
              ...info.map(
                (item, index) =>
                  `task_${index + 1}: ${item.session.id} | status: ${item.status.type} | title: ${item.session.title}`,
              ),
            ].join("\n"),
          }
        }

        const started = yield* armWaitWatch({
          ownerSessionID: ctx.sessionID,
          taskIDs: info.map((item) => item.session.id),
        })
        return {
          title,
          metadata: info.length === 1 ? meta(info[0]!.session.id) : {},
          output: [
            `status: watching`,
            `tasks_tracked: ${info.length}`,
            `watch_registration: ${started ? "started" : "already_registered"}`,
            `watch_persistence: recovered_after_restart`,
            `completion: ui_notification`,
            `result_access: inspect each task with task_async status using its task_id`,
            ...info.map(
              (item, index) =>
                `task_${index + 1}: ${item.session.id} | status: ${item.status.type} | title: ${item.session.title}`,
            ),
          ].join("\n"),
        }
      }

      if (action === "status") {
        const info = yield* load(params.task_id!)
        if (info.status.type === "idle") yield* Effect.sync(() => clearTaskTimeout(info.session.id))
        const model = info.user?.info.model
          ? `${info.user.info.model.providerID}/${info.user.info.model.modelID}`
          : info.assistant
            ? `${info.assistant.info.providerID}/${info.assistant.info.modelID}`
            : "unknown"

        ctx.metadata({ title: info.session.title, metadata: meta(info.session.id) })

        const { latest, visible } = snapshots(info.assistant, info.visibleAssistant, 4_000)
        const show = resultText(info.status, info.assistant, info.visibleAssistant, info.session, 4_000)
        const taskOutput = taskOutputState(info.status, info.assistant, info.visibleAssistant, info.session)
        const lastAssistantText = body(info.assistant) || body(info.visibleAssistant)
        const note = issue({ latest, visible })
        return {
          title: info.session.title,
          metadata: meta(info.session.id),
          output: [
            `task_id: ${info.session.id}`,
            `status: ${info.status.type}`,
            `title: ${info.session.title}`,
            `agent: ${info.user?.info.agent ?? info.assistant?.info.agent ?? "unknown"}`,
            `model: ${model}`,
            `messages: ${info.msgs.length}`,
            `created_at: ${new Date(info.session.time.created).toISOString()}`,
            `updated_at: ${new Date(info.session.time.updated).toISOString()}`,
            ...timeoutLines(info.session.id),
            info.status.type === "retry" ? `retry_attempt: ${info.status.attempt}` : undefined,
            info.status.type === "retry" ? `retry_message: ${info.status.message}` : undefined,
            info.status.type === "retry" ? `retry_next_at: ${new Date(info.status.next).toISOString()}` : undefined,
            info.assistant?.info.finish ? `last_finish: ${info.assistant.info.finish}` : "last_finish:",
            note?.warning ? `last_warning: ${note.note}` : "last_warning:",
            !note?.warning && note ? `last_error: ${note.note}` : "last_error:",
            text(info.user) ? `last_user: ${text(info.user)}` : "last_user:",
            lastAssistantText ? `last_assistant: ${lastAssistantText}` : "last_assistant:",
            taskOutput ? `task_output: ${taskOutput}` : undefined,
            "result:",
            show,
          ]
            .filter(Boolean)
            .join("\n"),
        }
      }

      if (action === "abort") {
        const info = yield* load(params.task_id!)
        yield* Effect.sync(() => clearTaskTimeout(info.session.id))
        const out = yield* Effect.promise(() =>
          Session.stopAll({
            sessionID: info.session.id,
            reason: `Requested by task_async ${action}`,
          }),
        )
        ctx.metadata({ title: info.session.title, metadata: meta(info.session.id) })

        return {
          title: info.session.title,
          metadata: meta(info.session.id),
          output: [`task_id: ${info.session.id}`, `status: aborted`, `sessions_aborted: ${out.sessions}`].join("\n"),
        }
      }

      if (action === "resume") {
        return yield* resume(params.task_id!)
      }

      if (action === "message") {
        const info = yield* load(params.task_id!)
        const user = info.user?.info
        const model = user
          ? {
              providerID: user.model.providerID,
              modelID: user.model.modelID,
            }
          : info.assistant
            ? {
                providerID: info.assistant.info.providerID,
                modelID: info.assistant.info.modelID,
              }
            : undefined

        if (!model) {
          return yield* Effect.fail(new Error(`Cannot determine model for task: ${info.session.id}`))
        }

        const ag = user?.agent ?? info.assistant?.info.agent
        if (!ag) {
          return yield* Effect.fail(new Error(`Cannot determine agent for task: ${info.session.id}`))
        }

        ctx.metadata({ title: info.session.title, metadata: meta(info.session.id, model) })

        const busy = info.status.type !== "idle"
        const restart = needsRestart(info.status, info.assistant, info.visibleAssistant, info.session)
        const parts = yield* Effect.promise(() => expand(params.message!))

        const timer = yield* launch({
          taskID: info.session.id,
          description: plain(info.session.title),
          timeoutMs: params.timeout_ms,
          clearTimeout: info.status.type === "idle" && !params.timeout_ms,
          run: async () => {
            if (restart) {
              await SessionPrompt.cancel(info.session.id).catch(() => undefined)
            }
            await SessionPrompt.prompt({
              sessionID: info.session.id,
              agent: ag,
              model,
              parts,
              noReply: true,
            })

            const out = await SessionPrompt.loop({ sessionID: info.session.id })
            if (!busy || restart) return out
            return SessionPrompt.loop({ sessionID: info.session.id })
          },
        })

        return {
          title: info.session.title,
          metadata: meta(info.session.id, model),
          output: [
            `task_id: ${info.session.id}`,
            `status: ${restart ? "restarted" : busy ? "queued" : "started"}`,
            restart ? `restart_reason: ${info.status.type === "retry" ? "retry" : "stalled"}` : undefined,
            `completion: ui_notification`,
            `result_access: use task_async wait or task_async status with this task_id`,
            ...(timer ? timeoutLines(info.session.id) : []),
          ]
            .filter(Boolean)
            .join("\n"),
        }
      }

      const txt = block.get(params.subagent_type!)
      if (txt) return yield* Effect.fail(new Error(txt))

      const next = yield* agent.get(params.subagent_type!)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }
      if (next.hidden) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${params.subagent_type} is not a valid agent type`))
      }

      const canTask = Permission.evaluate("task", "*", next.permission).action !== "deny"
      const canTodo = Permission.evaluate("todowrite", "*", next.permission).action !== "deny"
      const canAsync = Permission.evaluate(id, "start", next.permission).action !== "deny"

      const nextSession = yield* sessions.create({
        parentID: ctx.sessionID,
        title: params.description! + ` (@${next.name} async subagent)`,
        permission: [
          ...(canTodo
            ? []
            : [
                {
                  permission: "todowrite" as const,
                  pattern: "*" as const,
                  action: "deny" as const,
                },
              ]),
          ...(canTask
            ? []
            : [
                {
                  permission: "task" as const,
                  pattern: "*" as const,
                  action: "deny" as const,
                },
              ]),
          ...(canAsync
            ? []
            : [
                {
                  permission: id,
                  pattern: "*" as const,
                  action: "deny" as const,
                },
              ]),
          ...(cfg.experimental?.primary_tools?.map((item) => ({
            pattern: "*",
            action: "allow" as const,
            permission: item,
          })) ?? []),
        ],
      })

      const msg = yield* Effect.sync(() => MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }))
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }
      ctx.metadata({
        title: params.description,
        metadata: meta(nextSession.id, model),
      })
      const messageID = MessageID.ascending()
      const parts = yield* Effect.promise(() => expand(params.prompt!))

      const timer = yield* launch({
        taskID: nextSession.id,
        description: params.description!,
        timeoutMs: params.timeout_ms,
        run: () =>
          SessionPrompt.prompt({
            messageID,
            sessionID: nextSession.id,
            model: {
              modelID: model.modelID,
              providerID: model.providerID,
            },
            agent: next.name,
            tools: {
              ...(canTodo ? {} : { todowrite: false }),
              ...(canTask ? {} : { task: false }),
              ...(canAsync ? {} : { [id]: false }),
              ...Object.fromEntries((cfg.experimental?.primary_tools ?? []).map((item) => [item, false])),
            },
            parts,
          }),
      })

      return {
        title: params.description!,
        metadata: meta(nextSession.id, model),
        output: [
          `task_id: ${nextSession.id}`,
          `status: started`,
          `completion: ui_notification`,
          `result_access: use task_async wait or task_async status with this task_id`,
          ...(timer ? timeoutLines(nextSession.id) : []),
        ].join("\n"),
      }
    })

    return async (): Promise<Tool.DefWithoutID<typeof parameters>> => {
      await boot()
      return {
        description: DESCRIPTION,
        parameters,
        async execute(params, ctx) {
          return Effect.runPromise(run(params, ctx))
        },
      }
    }
  }),
)

export const TaskAsyncTestSupport = {
  resetWaitWatchesForTest() {
    for (const watch of waitWatches.values()) {
      watch.unsubscribe?.()
    }
    waitWatches.clear()
  },
}

export const TaskAsyncDescription: Tool.DynamicDescription = (agent) =>
  Effect.gen(function* () {
    const notes: string[] = []
    if (agent.name === "atlas") {
      notes.push("For `atlas`, use `task_async` as the async delegation surface for helper lanes, `lead`, and `niggli`.")
    }
    if (agent.name === "ayaz") {
      notes.push(
        "For `ayaz`, stay in direct execution by default. Use `task_async` only when a helper lane clearly reduces uncertainty, supports non-overlapping parallel work, or owns the dominant frontend, browser-proof, or independent-review slice; prefer `wait` over repeated `status`, use `message` for follow-up, and `resume` only for unfinished idle tasks.",
      )
    }
    if (agent.name === "niggli") {
      notes.push(
        "For `niggli`, use `task_async` only for planning-support helpers such as `architect`, `explorer`, `librarian`, or `hades`; keep the durable plan in `main-plan`.",
      )
    }
    if (agent.name === "lead") {
      notes.push("`lead` should use `task_async` for worker delegation, follow-up, waiting, and completion tracking.")
    }

    const rows = Action.options.map((item) => ({
      name: item,
      rule: Permission.evaluate(id, item, agent.permission),
    }))
    const label = (action: "allow" | "ask" | "deny") => {
      if (action === "allow") return "allowed"
      if (action === "ask") return "asks permission"
      return "denied"
    }
    const help: Record<(typeof Action.options)[number], string> = {
      start:
        "launch a new background subagent task with `description`, `prompt`, `subagent_type`, and optional `timeout_ms`; returns immediately with a `task_id`.",
      message:
        "send follow-up instructions into an existing task with `task_id` and `message`; can renew `timeout_ms` without aborting the task.",
      resume:
        "continue an existing task by `task_id` without adding a new message; optional `timeout_ms` renews the watchdog.",
      wait: "arm background completion watching for one or more owned tasks using `task_id` or `task_ids`; returns immediately unless every watched task is already idle.",
      status:
        "inspect one owned task by `task_id`, including current state, excerpts, retry/stall clues, and stored result output.",
      abort: "stop the owned task subtree rooted at `task_id`.",
    }
    const available = rows.filter((item) => item.rule.action !== "deny")
    const availableActions = available.length
      ? available.map((item) => `- \`${item.name}\` [${label(item.rule.action)}]: ${help[item.name]}`).join("\n")
      : "No `task_async` actions are available for this caller."
    const denied = rows.filter((item) => item.rule.action === "deny").map((item) => `\`${item.name}\``)
    const can = (action: (typeof Action.options)[number]) =>
      rows.find((item) => item.name === action)?.rule.action !== "deny"
    const start = can("start")
    const wait = can("wait")
    const status = can("status")
    const timeout = can("start") || can("message") || can("resume")

    const followup: string[] = []
    if (start && wait && status) {
      followup.push(
        `Recommended lifecycle for \`${agent.name}\`: use \`start\` to launch work, \`wait\` to arm non-blocking completion watching, and \`status\` to retrieve stored results later by \`task_id\`.`,
      )
    } else if (start && status) {
      followup.push(
        `Recommended lifecycle for \`${agent.name}\`: use \`start\` to launch work and \`status\` to retrieve stored results later by \`task_id\`.`,
      )
    } else if (wait || status) {
      followup.push(
        `For \`${agent.name}\`, \`task_async\` is currently a follow-up surface: use \`wait\` and/or \`status\` only on already-owned async tasks.`,
      )
    }
    if (wait) {
      followup.push(
        "Use `task_async wait` to arm background completion watching for one or more running tasks without repeated polling; active wait registrations are persisted and recovered across process restarts.",
      )
    }
    if (status) {
      followup.push(
        "Use `task_async status` for later result retrieval, explicit point inspection, and retry/stall visibility by `task_id`.",
      )
    }
    if (timeout) {
      followup.push(
        "Optional `timeout_ms` on `start`, `message`, or `resume` arms a timeout watch that shows a UI warning on expiry without aborting the task.",
      )
    }

    const items = yield* Effect.promise(() => Agent.list())
    const filtered = items.filter(
      (item) =>
        item.mode !== "primary" &&
        !item.hidden &&
        !block.has(item.name) &&
        Permission.evaluate(id, item.name, agent.permission).action !== "deny",
    )
    const agents = filtered
      .map((item) => {
        const rule = Permission.evaluate(id, item.name, agent.permission)
        return `- ${item.name} [${label(rule.action)}]: ${item.description ?? "This subagent should only be called manually by the user."}`
      })
      .join("\n")

    return [
      ...notes,
      "This tool is asynchronous: `start`, `message`, `resume`, and active `wait` registrations can return before background work is finished, completion appears as a UI notification instead of being injected into the caller session, results stay retrievable later through `task_async status` by `task_id`, and active `wait` registrations are persisted and recovered across process restarts.",
      ...followup,
      "Permission-tailored action view:",
      availableActions,
      denied.length
        ? `Denied for this caller: ${denied.join(", ")}.`
        : "All task lifecycle actions are available for this caller.",
      start
        ? agents
          ? [
              "Subagents available through `start` and when to use them:",
              "The descriptions below explain which visible subagent this tool can launch for the current caller.",
              agents,
            ].join("\n")
          : "`start` is available, but no visible permitted subagents are currently exposed through this tool."
        : "`start` is denied for this caller, so the startable subagent list is omitted.",
    ].join("\n")
  })
