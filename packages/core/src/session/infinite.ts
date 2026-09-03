export * as SessionInfinite from "./infinite.js"

import { ConfigInfinite } from "@opencode-ai/schema/config/infinite"
import { SessionSchema } from "./schema.js"

export const withSentinelInstruction = (text: string, sentinel: string): string => {
  if (text.includes(sentinel)) return text
  return `${text}\n\nWhen the task is fully complete, emit ${sentinel} on its own line.`
}

export const continuationPrompt = (sentinel: string): string =>
  `Continue working toward the objective. Do not stop until everything is done. When fully complete, emit ${sentinel} on its own line.`

export const containsSentinel = (text: string, sentinel: string): boolean => text.includes(sentinel)

export const isTerminated = (todos: ReadonlyArray<{ readonly status: string }>): boolean => {
  if (todos.length === 0) return true
  return todos.every((todo) => todo.status === "completed" || todo.status === "cancelled")
}

export const Defaults = {
  maxIterations: 100,
  maxHours: 8,
  sentinel: "[TASK_COMPLETE]",
  todoDetection: true,
} as const

export type Resolved = {
  readonly maxIterations: number
  readonly maxHours: number
  readonly sentinel: string
  readonly todoDetection: boolean
}

export const resolve = (infos: ReadonlyArray<ConfigInfinite.Info>): Resolved =>
  infos.reduce<Resolved>(
    (result, current) => ({
      maxIterations: current.maxIterations ?? result.maxIterations,
      maxHours: current.maxHours ?? result.maxHours,
      sentinel: current.sentinel ?? result.sentinel,
      todoDetection: current.todoDetection ?? result.todoDetection,
    }),
    { ...Defaults },
  )

const enabled = new Set<string>()
const progress = new Map<string, { readonly iterations: number; readonly startedAt: number }>()

export const enable = (sessionID: SessionSchema.ID): void => {
  enabled.add(sessionID)
  if (!progress.has(sessionID)) progress.set(sessionID, { iterations: 0, startedAt: Date.now() })
}

export const disable = (sessionID: SessionSchema.ID): void => {
  enabled.delete(sessionID)
  progress.delete(sessionID)
}

export const isEnabled = (sessionID: SessionSchema.ID): boolean => enabled.has(sessionID)

export const getProgress = (
  sessionID: SessionSchema.ID,
): { readonly iterations: number; readonly startedAt: number } | undefined => progress.get(sessionID)

export const recordIteration = (sessionID: SessionSchema.ID): void => {
  const current = progress.get(sessionID) ?? { iterations: 0, startedAt: Date.now() }
  progress.set(sessionID, { iterations: current.iterations + 1, startedAt: current.startedAt })
}

export const clear = (): void => {
  enabled.clear()
  progress.clear()
}
