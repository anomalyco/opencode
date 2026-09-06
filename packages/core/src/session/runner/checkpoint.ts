export * as TurnCheckpoint from "./checkpoint"

import { SessionSchema } from "../schema"
import { SessionMessage } from "../message"

export interface SettledToolCallRecord {
  readonly callID: string
  readonly name: string
  readonly input: unknown
  readonly result: unknown
  readonly output?: unknown
  readonly outputPaths?: ReadonlyArray<string>
  readonly timestamp: number
}

export interface TurnCheckpointState {
  readonly sessionID: SessionSchema.ID
  readonly step: number
  readonly assistantMessageID: SessionMessage.ID
  readonly settledCalls: ReadonlyArray<SettledToolCallRecord>
  readonly createdAt: number
  readonly updatedAt: number
  status: "active" | "completed" | "crashed" | "resumed"
}

const checkpointStore = new Map<string, TurnCheckpointState>()

export const recordSettledTool = (
  sessionID: SessionSchema.ID,
  entry: {
    readonly step: number
    readonly assistantMessageID: SessionMessage.ID
    readonly call: SettledToolCallRecord
  },
): TurnCheckpointState => {
  const existing = checkpointStore.get(sessionID)
  const now = Date.now()

  if (existing && existing.step === entry.step && existing.assistantMessageID === entry.assistantMessageID) {
    const updated: TurnCheckpointState = {
      ...existing,
      settledCalls: [...existing.settledCalls, entry.call],
      updatedAt: now,
      status: "active",
    }
    checkpointStore.set(sessionID, updated)
    return updated
  }

  const initial: TurnCheckpointState = {
    sessionID,
    step: entry.step,
    assistantMessageID: entry.assistantMessageID,
    settledCalls: [entry.call],
    createdAt: now,
    updatedAt: now,
    status: "active",
  }
  checkpointStore.set(sessionID, initial)
  return initial
}

export const getCheckpoint = (sessionID: SessionSchema.ID): TurnCheckpointState | undefined => {
  return checkpointStore.get(sessionID)
}

export const markTurnCrashed = (sessionID: SessionSchema.ID): TurnCheckpointState | undefined => {
  const existing = checkpointStore.get(sessionID)
  if (!existing) return undefined
  existing.status = "crashed"
  return existing
}

export const canResumeFromCheckpoint = (
  sessionID: SessionSchema.ID,
  step: number,
): boolean => {
  const cp = checkpointStore.get(sessionID)
  if (!cp) return false
  return cp.status === "crashed" && cp.step === step && cp.settledCalls.length > 0
}

export const resumeCheckpoint = (
  sessionID: SessionSchema.ID,
  step: number,
): ReadonlyArray<SettledToolCallRecord> | undefined => {
  const cp = checkpointStore.get(sessionID)
  if (!cp || cp.step !== step || cp.settledCalls.length === 0) return undefined
  cp.status = "resumed"
  return cp.settledCalls
}

export const clearCheckpoint = (sessionID: SessionSchema.ID): void => {
  checkpointStore.delete(sessionID)
}

export const isCallAlreadySettled = (
  sessionID: SessionSchema.ID,
  callID: string,
): SettledToolCallRecord | undefined => {
  const cp = checkpointStore.get(sessionID)
  if (!cp) return undefined
  return cp.settledCalls.find((c) => c.callID === callID)
}
