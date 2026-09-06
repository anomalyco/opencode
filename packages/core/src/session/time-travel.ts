export * as TimeTravel from "./time-travel"

import { Effect } from "effect"
import { desc, eq } from "drizzle-orm"
import { Database } from "../database/database"
import { SessionSchema } from "./schema"
import { SessionMessage } from "./message"
import { SessionStore } from "./store"
import { SessionTable, SessionMessageTable } from "./sql"
import { ReflectionState } from "./runner/reflection-state"
import { SessionRevert } from "./revert"

export interface HistoricalStepSnapshot {
  readonly sessionID: SessionSchema.ID
  readonly messageID: SessionMessage.ID
  readonly stepNumber: number
  readonly summary: string
  readonly timestamp: number
  readonly hypotheses: ReturnType<typeof ReflectionState.getHypotheses>
}

export interface ForkedTimelineResult {
  readonly originalSessionID: SessionSchema.ID
  readonly forkedSessionID: SessionSchema.ID
  readonly branchPointMessageID: SessionMessage.ID
  readonly steerInjected: string
  readonly createdAt: number
}

const forkedTimelinesStore = new Map<string, ForkedTimelineResult[]>()

export const stepBackward = Effect.fn("TimeTravel.stepBackward")(function* (
  sessionID: SessionSchema.ID,
  targetMessageID: SessionMessage.ID,
) {
  const db = (yield* Database.Service).db
  const rows = yield* db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.session_id, sessionID))
    .orderBy(desc(SessionMessageTable.seq))
    .all()
    .pipe(Effect.orDie)

  const targetIdx = rows.findIndex((r) => r.id === targetMessageID)
  if (targetIdx === -1) return undefined

  const targetRow = rows[targetIdx]!
  const hypotheses = ReflectionState.getHypotheses(sessionID)

  return {
    sessionID,
    messageID: targetMessageID,
    stepNumber: targetRow.seq,
    summary: `Step ${targetRow.seq} (${targetRow.type})`,
    timestamp: targetRow.time_created,
    hypotheses,
  } as HistoricalStepSnapshot
})

export const editAssumption = (
  sessionID: SessionSchema.ID,
  input: {
    readonly oldAssumption: string
    readonly newAssumption: string
  },
): { readonly success: boolean; readonly updatedHypothesesCount: number } => {
  const hypotheses = ReflectionState.getHypotheses(sessionID)
  let updatedCount = 0

  const updated = hypotheses.map((h) => {
    if (h.description.toLowerCase().includes(input.oldAssumption.toLowerCase())) {
      updatedCount++
      return {
        ...h,
        description: h.description.replace(new RegExp(input.oldAssumption, "gi"), input.newAssumption),
      }
    }
    return h
  })

  if (updatedCount > 0) {
    ReflectionState.setHypotheses(sessionID, updated)
    const steer = `[Time-Travel Edited Assumption]: Replaced "${input.oldAssumption}" with "${input.newAssumption}"`
    ReflectionState.addSteer(sessionID, steer)
    ReflectionState.addReasoningLog(sessionID, {
      type: "hypothesis_update",
      content: steer,
      metadata: { timeTravel: true, old: input.oldAssumption, new: input.newAssumption },
    })
  }

  return { success: updatedCount > 0, updatedHypothesesCount: updatedCount }
}

export const forkTimeline = Effect.fn("TimeTravel.forkTimeline")(function* (
  sessionID: SessionSchema.ID,
  branchPointMessageID: SessionMessage.ID,
  options?: {
    readonly modifiedAssumption?: string
    readonly branchName?: string
  },
) {
  const store = yield* SessionStore.Service
  const db = (yield* Database.Service).db
  const original = yield* store.get(sessionID)
  if (!original) return undefined

  const forkedSessionID = SessionSchema.ID.create()
  const now = Date.now()

  yield* db
    .insert(SessionTable)
    .values({
      id: forkedSessionID,
      project_id: original.projectID,
      parent_id: sessionID,
      slug: `fork-${forkedSessionID.slice(-6)}`,
      directory: original.location.directory,
      workspace_id: original.location.workspaceID,
      title: `[Forked Timeline] ${original.title || "Session"}`,
      version: "2",
      agent: original.agent,
      cost: 0,
      tokens_input: 0,
      tokens_output: 0,
      time_created: now,
      time_updated: now,
    })
    .pipe(Effect.orDie)

  const steerInjected = options?.modifiedAssumption
    ? `[Time-Travel Forked Timeline]: Active premise modified to: "${options.modifiedAssumption}". Branch point: ${branchPointMessageID}.`
    : `[Time-Travel Forked Timeline]: Forked from session ${sessionID} at message ${branchPointMessageID}.`

  ReflectionState.addSteer(forkedSessionID, steerInjected)
  ReflectionState.addReasoningLog(forkedSessionID, {
    type: "why_loop",
    content: steerInjected,
    metadata: { parentSessionID: sessionID, branchPoint: branchPointMessageID },
  })

  const result: ForkedTimelineResult = {
    originalSessionID: sessionID,
    forkedSessionID,
    branchPointMessageID,
    steerInjected,
    createdAt: now,
  }

  const existingForks = forkedTimelinesStore.get(sessionID) ?? []
  existingForks.push(result)
  forkedTimelinesStore.set(sessionID, existingForks)

  return result
})

export const getForkedTimelines = (sessionID: SessionSchema.ID): ReadonlyArray<ForkedTimelineResult> => {
  return forkedTimelinesStore.get(sessionID) ?? []
}
