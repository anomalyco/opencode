import { SessionID } from "../../session/schema"

export const timeoutLimitMs = 2_147_483_647
export const defaultTimeoutMs = 5 * 60_000

export type TaskTimeout = {
  starterID: SessionID
  starterAgent: string
  description: string
  timeoutMs: number
  expiresAt: number
  token: number
  state: "active" | "expired"
  timer?: ReturnType<typeof setTimeout>
  expiredAt?: number
}

const taskTimeouts = new Map<string, TaskTimeout>()

export function clearTaskTimeout(taskID: SessionID) {
  const hit = taskTimeouts.get(taskID)
  if (!hit) return
  if (hit.timer) clearTimeout(hit.timer)
  taskTimeouts.delete(taskID)
}

export function timeoutInfo(taskID: SessionID) {
  const hit = taskTimeouts.get(taskID)
  if (!hit) return { status: "none" as const }
  if (hit.state === "active") {
    return {
      status: "active" as const,
      timeoutMs: hit.timeoutMs,
      expiresAt: hit.expiresAt,
    }
  }
  return {
    status: "expired" as const,
    timeoutMs: hit.timeoutMs,
    expiredAt: hit.expiredAt ?? hit.expiresAt,
  }
}

export function timeoutLines(taskID: SessionID, prefix = "timeout") {
  const hit = timeoutInfo(taskID)
  if (hit.status === "active") {
    return [
      `${prefix}_status: ${hit.status}`,
      `${prefix}_ms: ${hit.timeoutMs}`,
      `${prefix}_expires_at: ${new Date(hit.expiresAt).toISOString()}`,
    ]
  }
  if (hit.status === "expired") {
    return [
      `${prefix}_status: ${hit.status}`,
      `${prefix}_ms: ${hit.timeoutMs}`,
      `${prefix}_expired_at: ${new Date(hit.expiredAt).toISOString()}`,
    ]
  }
  return [`${prefix}_status: ${hit.status}`]
}

export function resolveTimeoutMs(input: { taskID: SessionID; timeoutMs?: number; fallbackMs?: number }) {
  if (input.timeoutMs !== undefined) return input.timeoutMs
  const hit = timeoutInfo(input.taskID)
  if (hit.status === "active" || hit.status === "expired") return hit.timeoutMs
  return input.fallbackMs ?? defaultTimeoutMs
}

export function activeTaskTimeout(taskID: SessionID, token: number) {
  const hit = taskTimeouts.get(taskID)
  if (!hit || hit.token !== token || hit.state !== "active") return
  return hit
}

export function beginTaskTimeoutExpiry(taskID: SessionID, token: number) {
  const hit = activeTaskTimeout(taskID, token)
  if (!hit) return
  const expiredAt = Date.now()
  const next: TaskTimeout = {
    ...hit,
    state: "expired",
    expiredAt,
    timer: undefined,
  }
  taskTimeouts.set(taskID, next)
  return next
}

export function armTaskTimeout(input: {
  taskID: SessionID
  starterID: SessionID
  starterAgent: string
  description: string
  timeoutMs: number
  onExpire: (taskID: SessionID, token: number) => void
}) {
  const previous = taskTimeouts.get(input.taskID)
  if (previous?.timer) clearTimeout(previous.timer)
  const token = (previous?.token ?? 0) + 1
  const timer = setTimeout(() => {
    input.onExpire(input.taskID, token)
  }, input.timeoutMs)
  timer.unref?.()
  const next: TaskTimeout = {
    starterID: input.starterID,
    starterAgent: input.starterAgent,
    description: input.description,
    timeoutMs: input.timeoutMs,
    expiresAt: Date.now() + input.timeoutMs,
    token,
    state: "active",
    timer,
  }
  taskTimeouts.set(input.taskID, next)
  return next
}
