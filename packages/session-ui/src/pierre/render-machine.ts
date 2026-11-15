import {
  areFilesEqual,
  type FileContents,
  type FileDiffMetadata,
  type SelectedLineRange,
  type Virtualizer,
} from "@pierre/diffs"
import type { WorkerPoolManager } from "@pierre/diffs/worker"

/** A pool that never finishes initializing stops blocking a virtualized viewer after this long. */
export const POOL_INIT_TIMEOUT_MS = 10_000

/** A draw whose rows never appear (an empty diff Pierre renders without rows) settles after this long. */
export const ROWS_READY_TIMEOUT_MS = 2_000

export type PoolReadiness = "none" | "ready" | "initializing" | "broken"

export type ViewerTarget =
  | { readonly kind: "text"; readonly file: FileContents }
  | { readonly kind: "diff-patch"; readonly fileDiff: FileDiffMetadata }
  | { readonly kind: "diff-files"; readonly before: FileContents; readonly after: FileContents }
  | { readonly kind: "diff-empty" }

/** What a Pierre instance was built with. A virtualized instance keeps its first target and separators. */
export type ViewerInstanceSpec = {
  readonly virtualizer: Virtualizer | undefined
  readonly workerPool: WorkerPoolManager | undefined
  readonly hunkSeparators: unknown
  readonly target: ViewerTarget
}

export type ViewerRenderRequest = {
  readonly spec: ViewerInstanceSpec
  readonly pool: PoolReadiness
  /** Extra frames to wait once rows exist, so a virtualizer can measure them. */
  readonly settleFrames: number
  /** Pin the container's height while the draw replaces its rows, so the scroller does not jump. */
  readonly preserveHeight: boolean
  /** Whether the draw produces rows at all; an empty diff settles without waiting for them. */
  readonly expectsRows: boolean
}

export type MountedViewer = {
  readonly spec: ViewerInstanceSpec
  /** Whether the instance currently holds line annotations; each draw renders without them. */
  readonly annotated: boolean
}

export type ViewerDrawAction = "create" | "reset" | "update"

type Shared = {
  /** Draw count. Events from an earlier draw or pool wait are stale. */
  readonly attempt: number
  /** Changes on every draw; marks that live in Pierre's shadow DOM are applied again. */
  readonly revision: number
  readonly heightPinned: boolean
  /** A selection to scroll into a virtualized window once rows can be measured. */
  readonly reveal: SelectedLineRange | undefined
  /** A pool that timed out once; later draws use the main thread until it reports ready. */
  readonly timedOutPool: WorkerPoolManager | undefined
}

/**
 * One Pierre viewer instance. A virtualized viewer waits for its worker pool before the first draw (`awaiting-pool`);
 * each draw then waits for rows (`awaiting-rows`) and a few frames (`settling`) before the viewer reapplies the
 * selection, releases the pinned height and reports `ready`. Each wait has a bound.
 */
export type ViewerRenderState =
  | (Shared & { readonly status: "idle" })
  | (Shared & {
      readonly status: "awaiting-pool"
      readonly request: ViewerRenderRequest
      readonly mounted: MountedViewer | undefined
    })
  | (Shared & { readonly status: "awaiting-rows"; readonly mounted: MountedViewer; readonly settleFrames: number })
  | (Shared & { readonly status: "settling"; readonly mounted: MountedViewer; readonly framesLeft: number })
  | (Shared & { readonly status: "ready"; readonly mounted: MountedViewer; readonly outcome: "ready" | "timeout" })
  | { readonly status: "disposed" }

export type ViewerRenderEvent =
  | { readonly type: "render.requested"; readonly request: ViewerRenderRequest }
  | { readonly type: "pool.settled"; readonly attempt: number; readonly ok: boolean }
  | { readonly type: "pool.timed-out"; readonly attempt: number }
  | { readonly type: "rows.ready"; readonly attempt: number }
  | { readonly type: "rows.timed-out"; readonly attempt: number }
  | { readonly type: "settle.frame"; readonly attempt: number }
  | { readonly type: "annotations.synced"; readonly count: number }
  | { readonly type: "reveal.requested"; readonly range: SelectedLineRange | undefined }
  | { readonly type: "reveal.completed" }
  | { readonly type: "disposed" }

export type ViewerRenderEffect =
  | { readonly type: "cancel-async" }
  | { readonly type: "await-pool"; readonly attempt: number; readonly pool: WorkerPoolManager }
  | { readonly type: "preserve-height" }
  | { readonly type: "release-height" }
  | { readonly type: "draw"; readonly action: ViewerDrawAction; readonly spec: ViewerInstanceSpec }
  | { readonly type: "sync-annotations" }
  | { readonly type: "apply-annotations" }
  | { readonly type: "watch-rows"; readonly attempt: number }
  | { readonly type: "schedule-settle-frame"; readonly attempt: number }
  | { readonly type: "reapply-selection" }
  | { readonly type: "try-reveal"; readonly range: SelectedLineRange }
  | { readonly type: "refresh-find" }
  | { readonly type: "notify-rendered" }
  | { readonly type: "cleanup-instance" }

export type ViewerRenderTransition = {
  readonly state: ViewerRenderState
  readonly effects: readonly ViewerRenderEffect[]
}

type Active = Exclude<ViewerRenderState, { status: "disposed" }>

export const NO_RENDER_EFFECTS: readonly ViewerRenderEffect[] = Object.freeze([])

export const INITIAL_VIEWER_RENDER_STATE: ViewerRenderState = Object.freeze({
  status: "idle",
  attempt: 0,
  revision: 0,
  heightPinned: false,
  reveal: undefined,
  timedOutPool: undefined,
})

export const DISPOSED_VIEWER_RENDER_STATE: ViewerRenderState = Object.freeze({ status: "disposed" })

const CANCEL_ASYNC = { type: "cancel-async" } as const

export function transitionViewerRender(state: ViewerRenderState, event: ViewerRenderEvent): ViewerRenderTransition {
  if (state.status === "disposed") return { state, effects: NO_RENDER_EFFECTS }

  if (event.type === "disposed")
    return {
      state: DISPOSED_VIEWER_RENDER_STATE,
      effects: [
        CANCEL_ASYNC,
        ...(state.heightPinned ? [{ type: "release-height" as const }] : []),
        { type: "cleanup-instance" },
      ],
    }

  if (event.type === "render.requested") return request(state, event.request)

  if (event.type === "pool.settled" || event.type === "pool.timed-out") {
    if (state.status !== "awaiting-pool" || event.attempt !== state.attempt)
      return { state, effects: NO_RENDER_EFFECTS }
    const pool = state.request.spec.workerPool

    // A failed or hung pool falls back to highlighting on the main thread.
    if (event.type === "pool.timed-out") return draw({ ...state, timedOutPool: pool }, state.request, undefined)

    return draw(state, state.request, event.ok ? pool : undefined)
  }

  if (event.type === "rows.ready") {
    if (event.attempt !== state.attempt) return { state, effects: NO_RENDER_EFFECTS }

    if (state.status === "awaiting-rows") return settle(state, state.mounted, state.settleFrames)

    // Rows that arrive after the timeout still get the selection, reveal and search a ready draw gets.
    if (state.status === "ready" && state.outcome === "timeout") return settle(state, state.mounted, 1)

    return { state, effects: NO_RENDER_EFFECTS }
  }

  if (event.type === "settle.frame") {
    if (state.status !== "settling" || event.attempt !== state.attempt) return { state, effects: NO_RENDER_EFFECTS }

    if (state.framesLeft > 1)
      return {
        state: { ...state, framesLeft: state.framesLeft - 1 },
        effects: [{ type: "schedule-settle-frame", attempt: state.attempt }],
      }

    return finish(state, state.mounted, "ready")
  }

  if (event.type === "rows.timed-out") {
    if (state.status !== "awaiting-rows" || event.attempt !== state.attempt)
      return { state, effects: NO_RENDER_EFFECTS }

    // Release the pinned height and report the draw; the row watch stays in case rows are only slow.
    return finish(state, state.mounted, "timeout")
  }

  if (event.type === "annotations.synced") {
    const mounted = selectMounted(state)

    // Each draw renders without annotations, so there is nothing to clear when none were applied since.
    if (!mounted || (event.count === 0 && !mounted.annotated)) return { state, effects: NO_RENDER_EFFECTS }
    const annotated = event.count > 0

    return {
      state: mounted.annotated === annotated ? state : withMounted(state, { ...mounted, annotated }),
      effects: [{ type: "apply-annotations" }],
    }
  }

  if (event.type === "reveal.requested") {
    if (state.reveal === event.range) return { state, effects: NO_RENDER_EFFECTS }

    return {
      state: { ...state, reveal: event.range },
      effects: event.range && selectMounted(state) ? [{ type: "try-reveal", range: event.range }] : NO_RENDER_EFFECTS,
    }
  }

  if (state.reveal === undefined) return { state, effects: NO_RENDER_EFFECTS }

  return { state: { ...state, reveal: undefined }, effects: NO_RENDER_EFFECTS }
}

function request(state: Active, request: ViewerRenderRequest): ViewerRenderTransition {
  const pool = request.spec.workerPool
  const timedOutPool = request.pool === "ready" ? undefined : state.timedOutPool
  const virtualized = request.spec.virtualizer !== undefined

  // A virtualizer that first sees an empty file anchors its bottom edge, then jumps once the pool draws rows.
  if (virtualized && request.pool === "initializing" && pool && pool !== timedOutPool) {
    const attempt = state.attempt + 1

    return {
      state: {
        status: "awaiting-pool",
        attempt,
        revision: state.revision,
        heightPinned: state.heightPinned,
        reveal: state.reveal,
        timedOutPool,
        request,
        mounted: selectMounted(state),
      },
      effects: [...cancel(state), { type: "await-pool", attempt, pool }],
    }
  }

  const fallback = virtualized && (request.pool === "broken" || (pool !== undefined && pool === timedOutPool))

  return draw({ ...state, timedOutPool }, request, fallback ? undefined : pool)
}

function draw(
  state: Active,
  request: ViewerRenderRequest,
  pool: WorkerPoolManager | undefined,
): ViewerRenderTransition {
  const spec = pool === request.spec.workerPool ? request.spec : { ...request.spec, workerPool: pool }
  const previous = selectMounted(state)
  const action = !previous ? "create" : needsInstanceReset(previous.spec, spec) ? "reset" : "update"
  const attempt = state.attempt + 1
  const mounted = { spec, annotated: false }

  const shared = {
    attempt,
    revision: state.revision + 1,
    heightPinned: state.heightPinned || request.preserveHeight,
    reveal: state.reveal,
    timedOutPool: state.timedOutPool,
  }

  const effects: ViewerRenderEffect[] = [
    ...cancel(state),
    ...(request.preserveHeight && !state.heightPinned ? [{ type: "preserve-height" as const }] : []),
    { type: "draw", action, spec },
    { type: "sync-annotations" },
  ]

  if (!request.expectsRows) {
    const next = settle({ ...shared, status: "idle" }, mounted, request.settleFrames)

    return { state: next.state, effects: [...effects, ...next.effects] }
  }

  return {
    state: { ...shared, status: "awaiting-rows", mounted, settleFrames: request.settleFrames },
    effects: [...effects, { type: "watch-rows", attempt }],
  }
}

function settle(state: Active, mounted: MountedViewer, settleFrames: number): ViewerRenderTransition {
  return {
    state: { ...shared(state), status: "settling", mounted, framesLeft: Math.max(0, settleFrames) + 1 },
    effects: [{ type: "schedule-settle-frame", attempt: state.attempt }],
  }
}

function finish(state: Active, mounted: MountedViewer, outcome: "ready" | "timeout"): ViewerRenderTransition {
  return {
    state: { ...shared(state), heightPinned: false, status: "ready", mounted, outcome },
    effects: [
      ...(state.heightPinned ? [{ type: "release-height" as const }] : []),
      { type: "reapply-selection" },
      ...(state.reveal ? [{ type: "try-reveal" as const, range: state.reveal }] : []),
      { type: "refresh-find" },
      { type: "notify-rendered" },
    ],
  }
}

function cancel(state: Active) {
  if (state.status === "idle" || (state.status === "ready" && state.outcome === "ready")) return NO_RENDER_EFFECTS

  return [CANCEL_ASYNC]
}

function shared(state: Active) {
  return {
    attempt: state.attempt,
    revision: state.revision,
    heightPinned: state.heightPinned,
    reveal: state.reveal,
    timedOutPool: state.timedOutPool,
  }
}

function withMounted(state: Active, mounted: MountedViewer): ViewerRenderState {
  if (state.status === "idle") return state

  return { ...state, mounted }
}

function selectMounted(state: ViewerRenderState) {
  return state.status === "idle" || state.status === "disposed" ? undefined : state.mounted
}

export function readPoolState(pool: WorkerPoolManager | undefined): PoolReadiness {
  if (!pool) return "none"

  if (pool.isInitialized()) return "ready"

  return pool.isWorkingPool() ? "initializing" : "broken"
}

/**
 * Whether an instance must be rebuilt rather than updated in place. Instances keep the virtualizer and pool they were
 * built with; a virtualized diff also keeps its first target and hunk separators.
 */
export function needsInstanceReset(previous: ViewerInstanceSpec, next: ViewerInstanceSpec) {
  if (previous.virtualizer !== next.virtualizer || previous.workerPool !== next.workerPool) return true

  if (next.virtualizer === undefined) return false

  return previous.hunkSeparators !== next.hunkSeparators || targetChanged(previous.target, next.target)
}

function targetChanged(previous: ViewerTarget, next: ViewerTarget) {
  if (previous.kind === "diff-patch" && next.kind === "diff-patch") return previous.fileDiff !== next.fileDiff

  if (previous.kind === "diff-files" && next.kind === "diff-files")
    return !areFilesEqual(previous.before, next.before) || !areFilesEqual(previous.after, next.after)

  return previous.kind !== next.kind
}

/** Whether Pierre draws any rows for this diff. */
export function diffExpectsRows(target: ViewerTarget, expandUnchanged: boolean | undefined) {
  if (target.kind === "diff-empty") return false

  if (target.kind === "diff-patch")
    return (
      target.fileDiff.hunks.length > 0 ||
      (expandUnchanged === true && target.fileDiff.additionLines.length + target.fileDiff.deletionLines.length > 0)
    )

  if (target.kind === "diff-files") {
    if (expandUnchanged === true) return target.before.contents.length + target.after.contents.length > 0

    return target.before.contents !== target.after.contents
  }

  return true
}

export function selectRevision(state: ViewerRenderState) {
  return state.status === "disposed" ? 0 : state.revision
}

export function selectMountedSpec(state: ViewerRenderState) {
  return selectMounted(state)?.spec
}
