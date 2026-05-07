import type { SessionPending } from "@opencode-ai/sdk/v2/client"

export type PendingRuntime = "idle" | "busy"
export type PendingKnowledge = "unknown" | "known"
export type PendingShape = "empty" | "queueOnly" | "steerOnly" | "mixed"
export type PendingEditAxis = "none" | "editingSelf"
export type PendingNetworkAxis = "quiescent" | "refreshing" | "mutating" | "historyMutating"
export type PendingProjectionAxis = "none" | "stopProjected"
export type PendingControllerMode =
  | "hydratingExisting"
  | "idleClear"
  | "idlePending"
  | "busy"
  | "editingSelfIdle"
  | "editingSelfBusy"
  | "mutating"
  | "historyMutating"
export type PendingBlockReason =
  | "pending_unknown"
  | "mutation_in_flight"
  | "history_mutation_in_flight"
  | "editing_in_progress"
  | "editing_requires_empty_composer"
  | "blocked_by_pending"
  | "cannot_steer_now"

export type PendingActionResult<TState> =
  | { kind: "applied"; state: TState }
  | { kind: "blocked"; reason: PendingBlockReason; state?: TState }
  | { kind: "failed"; error: unknown; state?: TState }

export type PendingSnapshotCoordinatorBindings = {
  emptyState: SessionPending
  isKnown: (sessionID: string, directory?: string) => boolean
  read: (sessionID: string, directory?: string) => SessionPending
  write: (sessionID: string, pending: SessionPending, directory?: string) => void
  isLoading: (sessionID: string) => boolean
  setLoading: (sessionID: string, next: boolean | undefined) => void
  isMutating: (sessionID: string) => boolean
  setMutating: (sessionID: string, next: boolean | undefined) => void
  fetch: (sessionID: string, directory?: string) => Promise<SessionPending | undefined>
  onError: (error: unknown) => void
}

export type PendingCoordinatorScope = {
  directory?: string
}

export type PendingRefreshOptions = PendingCoordinatorScope & {
  force?: boolean
  supersede?: boolean
  background?: boolean
}

export type PendingMutationOptions = PendingCoordinatorScope & {
  throwOnError?: boolean
  suppressError?: (error: unknown) => boolean
}

export type PendingRefreshResult = "applied" | "skipped" | "failed"

export type PendingControllerInput = {
  existingSession: boolean
  runtime: PendingRuntime
  preferredFollowupLane?: "queue" | "steer"
  pendingKnowledge: PendingKnowledge
  pending?: SessionPending
  localEditID?: string
  composerHasDraft: boolean
  refreshInFlight: boolean
  followupMutationInFlight: boolean
  historyMutationInFlight: boolean
  stopProjectionActive: boolean
}

export type PendingControllerState = {
  runtime: PendingRuntime
  pendingKnowledge: PendingKnowledge
  networkAxis: PendingNetworkAxis
  projectionAxis: PendingProjectionAxis
  editAxis: PendingEditAxis
  pendingShape: PendingShape
  mode: PendingControllerMode
  effectivePending?: SessionPending
  primaryFollowupLane?: "queue" | "steer"
  canForegroundSubmit: boolean
  canQueueSubmit: boolean
  canSteerSubmit: boolean
  canStartEdit: boolean
  canSaveEdit: boolean
  canCancelEdit: boolean
  canRunHistoryMutation: boolean
  canResume: boolean
  canStop: boolean
  submitBlockedReason?: PendingBlockReason
}

type PendingLane = "steer" | "queue"

const stopProjectionActive = (input: PendingControllerInput) => {
  const serverStopRequested = input.pendingKnowledge === "known" && !!input.pending?.stopRequested
  if (serverStopRequested) return true
  if (!input.stopProjectionActive) return false
  return input.pendingKnowledge !== "known" || !input.pending?.paused
}

const projectedPending = (input: PendingControllerInput) => {
  if (input.pendingKnowledge !== "known" || !input.pending) return undefined
  const pending = input.pending
  if (!stopProjectionActive(input)) return pending
  const promotedSteers = pending.steer.map((item) => ({ ...item, lane: "queue" as const }))
  return {
    ...pending,
    paused: true,
    steer: [],
    queue: [...promotedSteers, ...pending.queue],
  } satisfies SessionPending
}

const networkAxis = (input: PendingControllerInput): PendingNetworkAxis => {
  if (input.historyMutationInFlight) return "historyMutating"
  if (input.followupMutationInFlight) return "mutating"
  if (input.refreshInFlight) return "refreshing"
  return "quiescent"
}

const hasPendingItem = (pending: SessionPending | undefined, itemID: string | undefined) =>
  !!itemID && !!pending && [...pending.steer, ...pending.queue].some((item) => item.id === itemID)

const editAxis = (input: PendingControllerInput, pending?: SessionPending): PendingEditAxis => {
  if (!input.localEditID) return "none"
  if (input.pendingKnowledge !== "known") return "editingSelf"
  return hasPendingItem(pending, input.localEditID) ? "editingSelf" : "none"
}

export const getVisibleEditingItemID = (input: PendingControllerInput): string | undefined => {
  if (!input.localEditID) return undefined
  if (input.pendingKnowledge !== "known") return input.localEditID
  const effectivePending = projectedPending(input)
  return hasPendingItem(effectivePending, input.localEditID) ? input.localEditID : undefined
}

const pendingShape = (pending?: SessionPending): PendingShape => {
  if (!pending) return "empty"
  if (pending.steer.length > 0 && pending.queue.length > 0) return "mixed"
  if (pending.steer.length > 0) return "steerOnly"
  if (pending.queue.length > 0) return "queueOnly"
  return "empty"
}

export const shouldClearLocalStopProjection = (input: {
  projected: boolean | undefined
  pending: SessionPending | undefined
  runtime: PendingRuntime
  projectedAtUserMessageID: string | null | undefined
  latestUserMessageID: string | undefined
}) => {
  if (!input.projected || !input.pending) return false
  if (input.pending.stopRequested) return false
  if (input.pending.paused) return true

  const marker = input.projectedAtUserMessageID
  if (marker === undefined) return true

  const latestUserMessageID = input.latestUserMessageID
  const userMessageAdvanced =
    marker === null ? latestUserMessageID !== undefined : latestUserMessageID !== undefined && latestUserMessageID !== marker
  if (userMessageAdvanced) return true

  const noPending = input.pending.steer.length === 0 && input.pending.queue.length === 0
  return input.runtime === "idle" && noPending
}

const canAttemptSteer = (input: PendingControllerInput, pending?: SessionPending) =>
  input.runtime === "busy" &&
  input.pendingKnowledge === "known" &&
  !stopProjectionActive(input) &&
  !pending?.paused &&
  !pending?.stopRequested

const controllerMode = (input: PendingControllerInput, effectivePending?: SessionPending): PendingControllerMode => {
  const net = networkAxis(input)
  const edit = editAxis(input, effectivePending)
  const shape = pendingShape(effectivePending)

  if (net === "historyMutating") return "historyMutating"
  if (net === "mutating") return "mutating"
  if (edit === "editingSelf") return input.runtime === "busy" ? "editingSelfBusy" : "editingSelfIdle"
  if (input.existingSession && input.pendingKnowledge === "unknown") return "hydratingExisting"
  if (input.runtime === "busy") return "busy"
  if (shape === "empty") return "idleClear"
  return "idlePending"
}

export const getForegroundSubmitBlockReason = (input: PendingControllerInput): PendingBlockReason | undefined => {
  const effectivePending = projectedPending(input)
  const net = networkAxis(input)
  const edit = editAxis(input, effectivePending)
  const shape = pendingShape(effectivePending)
  const pausedQueueOnly =
    input.pendingKnowledge === "known" &&
    input.runtime === "idle" &&
    !!effectivePending?.paused &&
    shape === "queueOnly"

  if (net === "historyMutating") return "history_mutation_in_flight"
  if (net === "mutating") return "mutation_in_flight"
  if (edit === "editingSelf") return "editing_in_progress"
  if (input.existingSession && input.pendingKnowledge === "unknown") return "pending_unknown"
  if (input.runtime !== "idle") return "blocked_by_pending"
  if (pausedQueueOnly) return undefined
  if (shape !== "empty") return "blocked_by_pending"
  return undefined
}

export const getQueueSubmitBlockReason = (input: PendingControllerInput): PendingBlockReason | undefined => {
  const effectivePending = projectedPending(input)
  const net = networkAxis(input)
  const edit = editAxis(input, effectivePending)

  if (!input.existingSession) return "blocked_by_pending"
  if (net === "historyMutating") return "history_mutation_in_flight"
  if (net === "mutating") return "mutation_in_flight"
  if (edit === "editingSelf") return "editing_in_progress"
  if (stopProjectionActive(input)) return "blocked_by_pending"
  if (input.pendingKnowledge === "unknown") return "pending_unknown"
  if (input.runtime !== "busy") return "blocked_by_pending"
  return undefined
}

export const getSteerSubmitBlockReason = (input: PendingControllerInput): PendingBlockReason | undefined => {
  const queueReason = getQueueSubmitBlockReason(input)
  if (queueReason) return queueReason
  const effectivePending = projectedPending(input)
  if (!canAttemptSteer(input, effectivePending)) return "cannot_steer_now"
  return undefined
}

export const getStartEditBlockReason = (input: PendingControllerInput): PendingBlockReason | undefined => {
  const effectivePending = projectedPending(input)
  const net = networkAxis(input)
  const edit = editAxis(input, effectivePending)
  const shape = pendingShape(effectivePending)

  if (net === "historyMutating") return "history_mutation_in_flight"
  if (net === "mutating") return "mutation_in_flight"
  if (input.pendingKnowledge === "unknown") return "pending_unknown"
  if (edit === "editingSelf") return "editing_in_progress"
  if (input.composerHasDraft) return "editing_requires_empty_composer"
  if (shape === "empty") return "blocked_by_pending"
  return undefined
}

export const getEditSaveBlockReason = (input: PendingControllerInput): PendingBlockReason | undefined => {
  const effectivePending = projectedPending(input)
  const net = networkAxis(input)
  const edit = editAxis(input, effectivePending)

  if (net === "historyMutating") return "history_mutation_in_flight"
  if (net === "mutating") return "mutation_in_flight"
  if (input.pendingKnowledge === "unknown") return "pending_unknown"
  if (edit !== "editingSelf") return "blocked_by_pending"
  return undefined
}

export const getEditCancelBlockReason = getEditSaveBlockReason

export const getHistoryMutationBlockReason = (input: PendingControllerInput): PendingBlockReason | undefined => {
  const effectivePending = projectedPending(input)
  const net = networkAxis(input)
  const edit = editAxis(input, effectivePending)
  const shape = pendingShape(effectivePending)

  if (net === "historyMutating") return "history_mutation_in_flight"
  if (net === "mutating") return "mutation_in_flight"
  if (edit === "editingSelf") return "editing_in_progress"
  if (input.existingSession && input.pendingKnowledge === "unknown") return "pending_unknown"
  if (shape !== "empty") return "blocked_by_pending"
  return undefined
}

export const getResumeBlockReason = (input: PendingControllerInput): PendingBlockReason | undefined => {
  const effectivePending = projectedPending(input)
  const net = networkAxis(input)
  const edit = editAxis(input, effectivePending)

  if (net === "historyMutating") return "history_mutation_in_flight"
  if (net === "mutating") return "mutation_in_flight"
  if (input.pendingKnowledge === "unknown") return "pending_unknown"
  if (edit === "editingSelf") return "editing_in_progress"
  if (input.runtime !== "idle") return "blocked_by_pending"
  if (!effectivePending?.paused) return "blocked_by_pending"
  return undefined
}

export const getPendingItemActionBlockReason = (input: PendingControllerInput): PendingBlockReason | undefined => {
  const effectivePending = projectedPending(input)
  const net = networkAxis(input)
  const edit = editAxis(input, effectivePending)

  if (net === "historyMutating") return "history_mutation_in_flight"
  if (net === "mutating") return "mutation_in_flight"
  if (input.pendingKnowledge === "unknown") return "pending_unknown"
  if (edit === "editingSelf") return "editing_in_progress"
  return undefined
}

export const getPendingMoveLaneBlockReason = (
  input: PendingControllerInput,
  lane: PendingLane,
): PendingBlockReason | undefined => {
  const reason = getPendingItemActionBlockReason(input)
  if (reason) return reason
  if (lane !== "steer") return undefined
  const effectivePending = projectedPending(input)
  if (!canAttemptSteer(input, effectivePending)) return "cannot_steer_now"
  return undefined
}

export const resolveFollowupLane = (input: {
  primaryFollowupLane?: PendingLane
  override: boolean
  canQueueSubmit: boolean
  canSteerSubmit: boolean
}): PendingLane | undefined => {
  const primary = input.primaryFollowupLane
  if (!primary) return undefined

  const canSubmit = (lane: PendingLane) => (lane === "queue" ? input.canQueueSubmit : input.canSteerSubmit)
  const requested = input.override ? (primary === "queue" ? "steer" : "queue") : primary
  if (canSubmit(requested)) return requested
  return canSubmit(primary) ? primary : undefined
}

export const derivePendingControllerState = (input: PendingControllerInput): PendingControllerState => {
  const effectivePending = projectedPending(input)
  const state: PendingControllerState = {
    runtime: input.runtime,
    pendingKnowledge: input.pendingKnowledge,
    networkAxis: networkAxis(input),
    projectionAxis: stopProjectionActive(input) ? "stopProjected" : "none",
    editAxis: editAxis(input, effectivePending),
    pendingShape: pendingShape(effectivePending),
    mode: controllerMode(input, effectivePending),
    effectivePending,
    primaryFollowupLane: undefined,
    canForegroundSubmit: false,
    canQueueSubmit: false,
    canSteerSubmit: false,
    canStartEdit: false,
    canSaveEdit: false,
    canCancelEdit: false,
    canRunHistoryMutation: false,
    canResume: false,
    canStop: input.runtime === "busy",
    submitBlockedReason: undefined,
  }

  state.submitBlockedReason = getForegroundSubmitBlockReason(input)
  state.canForegroundSubmit = !state.submitBlockedReason
  state.canQueueSubmit = !getQueueSubmitBlockReason(input)
  state.canSteerSubmit = !getSteerSubmitBlockReason(input)
  state.canStartEdit = !getStartEditBlockReason(input)
  state.canSaveEdit = !getEditSaveBlockReason(input)
  state.canCancelEdit = !getEditCancelBlockReason(input)
  state.canRunHistoryMutation = !getHistoryMutationBlockReason(input)
  state.canResume = !getResumeBlockReason(input)
  const preferred = input.preferredFollowupLane ?? "steer"
  const fallback = preferred === "steer" ? "queue" : "steer"
  const canSubmitLane = (lane: PendingLane) => (lane === "steer" ? state.canSteerSubmit : state.canQueueSubmit)
  state.primaryFollowupLane =
    input.runtime === "busy"
      ? canSubmitLane(preferred)
        ? preferred
        : canSubmitLane(fallback)
          ? fallback
          : undefined
      : undefined
  return state
}

const nextVersion = (versions: Map<string, number>, sessionID: string) => {
  const next = (versions.get(sessionID) ?? 0) + 1
  versions.set(sessionID, next)
  return next
}

const snapshotSignature = (pending: SessionPending | undefined) => (pending ? JSON.stringify(pending) : undefined)

export function createPendingSnapshotCoordinator(bindings: PendingSnapshotCoordinatorBindings) {
  const refreshVersions = new Map<string, number>()
  const mutationVersions = new Map<string, number>()
  const refreshTasks = new Map<string, Promise<PendingRefreshResult>>()

  const blocked = (
    sessionID: string,
    reason?: PendingBlockReason,
    scope?: PendingCoordinatorScope,
  ): PendingActionResult<SessionPending> => ({
    kind: "blocked",
    reason: reason ?? "blocked_by_pending",
    state: bindings.isKnown(sessionID, scope?.directory)
      ? bindings.read(sessionID, scope?.directory)
      : bindings.emptyState,
  })

  const authoritative = (sessionID: string, state: SessionPending, scope?: PendingCoordinatorScope) => {
    nextVersion(mutationVersions, sessionID)
    bindings.write(sessionID, state, scope?.directory)
    bindings.setLoading(sessionID, undefined)
  }

  const refresh = (sessionID: string, opts?: PendingRefreshOptions): Promise<PendingRefreshResult> => {
    const currentTask = refreshTasks.get(sessionID)
    if (!opts?.supersede && bindings.isLoading(sessionID) && currentTask) return currentTask
    if (!opts?.force) {
      if (bindings.isMutating(sessionID)) return currentTask ?? Promise.resolve("skipped")
      if (bindings.isKnown(sessionID, opts?.directory)) return currentTask ?? Promise.resolve("skipped")
    } else if (bindings.isMutating(sessionID)) {
      return currentTask ?? Promise.resolve("skipped")
    }

    const refreshVersion = nextVersion(refreshVersions, sessionID)
    const seenMutationVersion = mutationVersions.get(sessionID) ?? 0
    const seenKnown = bindings.isKnown(sessionID, opts?.directory)
    const seenSnapshotSignature = seenKnown
      ? snapshotSignature(bindings.read(sessionID, opts?.directory))
      : undefined
    const showLoading = !opts?.background || !bindings.isKnown(sessionID, opts?.directory)
    if (showLoading) bindings.setLoading(sessionID, true)

    let task: Promise<PendingRefreshResult>
    task = bindings
      .fetch(sessionID, opts?.directory)
      .then((pending) => {
        if (!pending) return "skipped" as const
        if ((refreshVersions.get(sessionID) ?? 0) !== refreshVersion) return "skipped" as const
        if ((mutationVersions.get(sessionID) ?? 0) !== seenMutationVersion) return "skipped" as const
        const currentKnown = bindings.isKnown(sessionID, opts?.directory)
        if (currentKnown !== seenKnown) return "skipped" as const
        if (
          currentKnown &&
          snapshotSignature(bindings.read(sessionID, opts?.directory)) !== seenSnapshotSignature
        ) {
          return "skipped" as const
        }
        bindings.write(sessionID, pending, opts?.directory)
        return "applied" as const
      })
      .catch((error) => {
        bindings.onError(error)
        return "failed" as const
      })
      .finally(() => {
        if (showLoading && (refreshVersions.get(sessionID) ?? 0) === refreshVersion) {
          bindings.setLoading(sessionID, undefined)
        }
        if (refreshTasks.get(sessionID) === task) refreshTasks.delete(sessionID)
      })

    refreshTasks.set(sessionID, task)
    return task
  }

  const mutate = async (
    sessionID: string,
    reason: PendingBlockReason | undefined,
    task: () => Promise<{ data?: SessionPending }>,
    opts?: PendingMutationOptions,
  ): Promise<PendingActionResult<SessionPending>> => {
    if (reason) return blocked(sessionID, reason, opts)
    if (!bindings.isKnown(sessionID, opts?.directory)) return blocked(sessionID, "pending_unknown", opts)
    if (bindings.isMutating(sessionID)) return blocked(sessionID, "mutation_in_flight", opts)

    nextVersion(mutationVersions, sessionID)
    bindings.setMutating(sessionID, true)

    try {
      const result = await task()
      const next = result.data ?? bindings.emptyState
      bindings.write(sessionID, next, opts?.directory)
      return {
        kind: "applied",
        state: next,
      }
    } catch (error) {
      if (!opts?.suppressError?.(error)) bindings.onError(error)
      if (opts?.throwOnError) throw error
      return {
        kind: "failed",
        error,
        state: bindings.isKnown(sessionID, opts?.directory)
          ? bindings.read(sessionID, opts?.directory)
          : bindings.emptyState,
      }
    } finally {
      bindings.setMutating(sessionID, undefined)
    }
  }

  return {
    authoritative,
    blocked,
    refresh,
    mutate,
  }
}
