export const MAX_DIFF_CHANGED_LINES = 500

/** Diffs mount once they come within this many pixels of the scroll viewport. */
export const REVIEW_MOUNT_MARGIN = 300

/**
 * The review's open files and which open diffs have mounted. `controlled` follows the `open` prop; `uncontrolled` owns
 * the list. `mounted` latches an open file once it nears the viewport, so scrolling past it never unmounts a diff;
 * collapsing the file drops it. `measureQueued` is a viewport measurement waiting for the next frame.
 */
export type SessionReviewState =
  | {
      readonly status: "active"
      readonly mode: "controlled" | "uncontrolled"
      readonly files: readonly string[]
      readonly open: readonly string[]
      readonly openSet: ReadonlySet<string>
      readonly mounted: ReadonlySet<string>
      /** Files whose large-diff gate the user bypassed with "Render anyway". */
      readonly forced: ReadonlySet<string>
      readonly measureQueued: boolean
    }
  | { readonly status: "disposed" }

export type SessionReviewEvent =
  | { readonly type: "props.synced"; readonly files: readonly string[]; readonly open: readonly string[] | undefined }
  /** The user expanded or collapsed files. */
  | { readonly type: "open.changed"; readonly files: readonly string[] }
  /** A scroll, resize or list change may have moved diffs into view. */
  | { readonly type: "measure.requested" }
  /** `visible` is null when the scroll container is detached or has no size (hidden, collapsed). */
  | { readonly type: "viewport.measured"; readonly visible: ReadonlySet<string> | null }
  | { readonly type: "force.requested"; readonly file: string }
  | { readonly type: "disposed" }

export type SessionReviewEffect =
  | { readonly type: "notify-open"; readonly files: readonly string[] }
  | { readonly type: "schedule-measure" }
  | { readonly type: "cancel-measure" }

export type SessionReviewTransition = {
  readonly state: SessionReviewState
  readonly effects: readonly SessionReviewEffect[]
}

export type SessionReviewFileBody = "collapsed" | "placeholder" | "too-large" | "mounted"

export const MEASURE_REQUESTED_EVENT: SessionReviewEvent = Object.freeze({ type: "measure.requested" })

export const DISPOSED_SESSION_REVIEW_EVENT: SessionReviewEvent = Object.freeze({ type: "disposed" })

export const DISPOSED_SESSION_REVIEW_STATE: SessionReviewState = Object.freeze({ status: "disposed" })

const NO_EFFECTS: readonly SessionReviewEffect[] = Object.freeze([])

const SCHEDULE: readonly SessionReviewEffect[] = Object.freeze([Object.freeze({ type: "schedule-measure" as const })])

const CANCEL: readonly SessionReviewEffect[] = Object.freeze([Object.freeze({ type: "cancel-measure" as const })])

const EMPTY_FILES: readonly string[] = Object.freeze([])

const EMPTY_SET: ReadonlySet<string> = new Set()

export function createSessionReviewState(
  files: readonly string[],
  open: readonly string[] | undefined,
): SessionReviewState {
  const list = open === undefined ? EMPTY_FILES : unique(open)

  return {
    status: "active",
    mode: open === undefined ? "uncontrolled" : "controlled",
    files,
    open: list,
    openSet: new Set(list),
    mounted: EMPTY_SET,
    forced: EMPTY_SET,
    measureQueued: false,
  }
}

export function transitionSessionReview(state: SessionReviewState, event: SessionReviewEvent): SessionReviewTransition {
  if (state.status === "disposed") return { state, effects: NO_EFFECTS }

  if (event.type === "disposed") {
    return { state: DISPOSED_SESSION_REVIEW_STATE, effects: state.measureQueued ? CANCEL : NO_EFFECTS }
  }

  if (event.type === "props.synced") {
    const fileSet = new Set(event.files)
    const mode = event.open === undefined ? "uncontrolled" : "controlled"
    const open = event.open === undefined ? state.open.filter((file) => fileSet.has(file)) : unique(event.open)

    return reopen(state, { mode, files: event.files, open, fileSet })
  }

  if (event.type === "open.changed") {
    const next = unique(event.files)

    // The parent owns the list: it answers through `props.synced`.
    if (state.mode === "controlled") return { state, effects: [{ type: "notify-open", files: next }] }

    const fileSet = new Set(state.files)
    const step = reopen(state, {
      mode: state.mode,
      files: state.files,
      open: next.filter((file) => fileSet.has(file)),
      fileSet,
    })

    return { state: step.state, effects: [{ type: "notify-open", files: next }, ...step.effects] }
  }

  if (event.type === "measure.requested") {
    if (state.measureQueued || state.openSet.size === 0) return { state, effects: NO_EFFECTS }

    return { state: { ...state, measureQueued: true }, effects: SCHEDULE }
  }

  if (event.type === "viewport.measured") {
    const mounted = event.visible === null ? state.mounted : latch(state.mounted, event.visible, state.openSet)

    if (!state.measureQueued && mounted === state.mounted) return { state, effects: NO_EFFECTS }

    return { state: { ...state, measureQueued: false, mounted }, effects: NO_EFFECTS }
  }

  if (!state.openSet.has(event.file) || (state.forced.has(event.file) && state.mounted.has(event.file))) {
    return { state, effects: NO_EFFECTS }
  }

  return {
    state: {
      ...state,
      forced: state.forced.has(event.file) ? state.forced : new Set([...state.forced, event.file]),
      mounted: state.mounted.has(event.file) ? state.mounted : new Set([...state.mounted, event.file]),
    },
    effects: NO_EFFECTS,
  }
}

export function selectSessionReviewOpen(state: SessionReviewState) {
  return state.status === "active" ? state.open : EMPTY_FILES
}

export function selectSessionReviewExpanded(state: SessionReviewState, file: string, canRender: boolean) {
  return state.status === "active" && canRender && state.openSet.has(file)
}

export function selectSessionReviewFileBody(
  state: SessionReviewState,
  input: {
    readonly file: string
    readonly canRender: boolean
    readonly changedLines: number
    readonly isMedia: boolean
    readonly pinned: boolean
  },
): SessionReviewFileBody {
  if (state.status !== "active" || !selectSessionReviewExpanded(state, input.file, input.canRender)) return "collapsed"

  if (!input.isMedia && !state.forced.has(input.file) && input.changedLines > MAX_DIFF_CHANGED_LINES) {
    return "too-large"
  }

  if (input.pinned || state.mounted.has(input.file)) return "mounted"

  return "placeholder"
}

function reopen(
  state: Extract<SessionReviewState, { status: "active" }>,
  next: {
    readonly mode: "controlled" | "uncontrolled"
    readonly files: readonly string[]
    readonly open: readonly string[]
    readonly fileSet: ReadonlySet<string>
  },
): SessionReviewTransition {
  const filesChanged = !sameList(state.files, next.files)
  const openChanged = !sameList(state.open, next.open)
  const open = openChanged ? next.open : state.open
  const openSet = openChanged ? new Set(open) : state.openSet
  const mounted = prune(state.mounted, (file) => openSet.has(file) && next.fileSet.has(file))
  const forced = prune(state.forced, (file) => next.fileSet.has(file))
  const queue = openSet.size > 0 && (filesChanged || openChanged) && !state.measureQueued
  const cancel = openSet.size === 0 && state.measureQueued
  const measureQueued = queue ? true : cancel ? false : state.measureQueued

  if (
    !filesChanged &&
    !openChanged &&
    next.mode === state.mode &&
    mounted === state.mounted &&
    forced === state.forced &&
    measureQueued === state.measureQueued
  ) {
    return { state, effects: NO_EFFECTS }
  }

  return {
    state: {
      status: "active",
      mode: next.mode,
      files: filesChanged ? next.files : state.files,
      open,
      openSet,
      mounted,
      forced,
      measureQueued,
    },
    effects: queue ? SCHEDULE : cancel ? CANCEL : NO_EFFECTS,
  }
}

/** Adds the open files that came into view, keeping the same Set when none is new so a scroll writes nothing. */
function latch(mounted: ReadonlySet<string>, visible: ReadonlySet<string>, openSet: ReadonlySet<string>) {
  // Runs every scrolled frame: allocate only when an open file is new.
  for (const file of visible) {
    if (openSet.has(file) && !mounted.has(file)) {
      return new Set([...mounted, ...[...visible].filter((item) => openSet.has(item))])
    }
  }

  return mounted
}

function prune(set: ReadonlySet<string>, keep: (file: string) => boolean) {
  if ([...set].every(keep)) return set

  return new Set([...set].filter(keep))
}

function unique(files: readonly string[]) {
  return [...new Set(files)]
}

function sameList(a: readonly string[], b: readonly string[]) {
  return a === b || (a.length === b.length && a.every((file, index) => file === b[index]))
}
