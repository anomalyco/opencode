/** Where an open disclosure's body is: shown at once, waiting for a frame, or mounted after one. */
export type DisclosureMount =
  | { readonly phase: "immediate" }
  | { readonly phase: "scheduled"; readonly attempt: number }
  | { readonly phase: "mounted" }

/** `deferred` shares one frame-spaced queue across the timeline; `frame` waits a single frame. */
export type DisclosureQueue = "deferred" | "frame"

export type DisclosureProps = {
  readonly open: boolean | undefined
  readonly defaultOpen: boolean
  readonly forceOpen: boolean
  readonly defer: boolean
}

export type DisclosureCapabilities = {
  readonly locked: boolean
  readonly pending: boolean
  readonly allowOpenWhilePending: boolean
}

type Shared = {
  /** `controlled` while the owner passes `open`; a toggle then only asks the owner. */
  readonly control: "controlled" | "uncontrolled"
  /** The user toggled an uncontrolled disclosure, so it no longer follows `defaultOpen`. */
  readonly touched: boolean
  /** `forceOpen` was on at the last sync, so only its next rising edge opens again. */
  readonly forced: boolean
  /** Scheduled body mounts; a frame whose attempt is not the current one is stale. */
  readonly attempts: number
}

export type DisclosureState =
  | (Shared & { readonly status: "closed" })
  | (Shared & { readonly status: "open"; readonly mount: DisclosureMount })

export type DisclosureEvent =
  | { readonly type: "props.sync"; readonly props: DisclosureProps }
  | {
      readonly type: "toggle.requested"
      readonly open: boolean
      readonly defer: boolean
      readonly capabilities: DisclosureCapabilities
    }
  | { readonly type: "mount.ready"; readonly attempt: number }
  | { readonly type: "disposed" }

export type DisclosureEffect =
  | { readonly type: "notify"; readonly open: boolean }
  | { readonly type: "schedule-mount"; readonly attempt: number; readonly queue: DisclosureQueue }
  | { readonly type: "cancel-mount"; readonly attempt: number }

export type DisclosureTransition = {
  readonly state: DisclosureState
  readonly effects: readonly DisclosureEffect[]
}

const NO_EFFECTS: readonly DisclosureEffect[] = Object.freeze([])

/** The first open state. `queue` is how a body that starts open and deferred waits for its first frame. */
export function createDisclosureState(props: DisclosureProps, queue: DisclosureQueue): DisclosureTransition {
  const control = props.open === undefined ? "uncontrolled" : "controlled"
  const open = props.open ?? (props.forceOpen || props.defaultOpen)
  const shared = { control, touched: props.forceOpen && control === "uncontrolled", forced: props.forceOpen } as const
  const notify = props.forceOpen && props.open === false ? [{ type: "notify" as const, open: true }] : []

  if (!open) return { state: { ...shared, status: "closed", attempts: 0 }, effects: notify }

  if (!props.defer)
    return { state: { ...shared, status: "open", attempts: 0, mount: { phase: "immediate" } }, effects: notify }

  return {
    state: { ...shared, status: "open", attempts: 1, mount: { phase: "scheduled", attempt: 1 } },
    effects: [...notify, { type: "schedule-mount", attempt: 1, queue }],
  }
}

export function transitionDisclosure(state: DisclosureState, event: DisclosureEvent): DisclosureTransition {
  if (event.type === "props.sync") return sync(state, event.props)

  if (event.type === "mount.ready") {
    if (state.status !== "open" || state.mount.phase !== "scheduled" || state.mount.attempt !== event.attempt)
      return { state, effects: NO_EFFECTS }

    return { state: { ...state, mount: { phase: "mounted" } }, effects: NO_EFFECTS }
  }

  if (event.type === "disposed") {
    const closed = {
      status: "closed",
      control: state.control,
      touched: false,
      forced: false,
      attempts: state.attempts,
    } as const

    return { state: closed, effects: cancel(state) }
  }

  const open = state.status === "open"

  if (event.capabilities.locked || (event.capabilities.pending && !event.capabilities.allowOpenWhilePending))
    return { state, effects: NO_EFFECTS }

  if (event.open === open) {
    if (state.control === "controlled" || state.touched) return { state, effects: NO_EFFECTS }

    return { state: { ...state, touched: true }, effects: NO_EFFECTS }
  }

  // The owner of a controlled disclosure decides; it answers with a new `open` prop.
  if (state.control === "controlled") return { state, effects: [{ type: "notify", open: event.open }] }

  const next = move(state, event.open, event.defer)

  return { state: { ...next.state, touched: true }, effects: [...next.effects, { type: "notify", open: event.open }] }
}

export function viewDisclosure(state: DisclosureState, capabilities: DisclosureCapabilities) {
  const open = state.status === "open"

  return {
    open,
    mounted: open && state.mount.phase !== "scheduled",
    canToggle: !capabilities.locked && (!capabilities.pending || capabilities.allowOpenWhilePending),
  }
}

function sync(state: DisclosureState, props: DisclosureProps): DisclosureTransition {
  const control = props.open === undefined ? "uncontrolled" : "controlled"
  const rising = props.forceOpen && !state.forced
  // A forced open counts as the user's: it stays open once `forceOpen` drops.
  const touched = control === "uncontrolled" && state.control === "uncontrolled" && (state.touched || rising)
  const open = props.open ?? (touched ? rising || state.status === "open" : props.defaultOpen)
  const notify = rising && state.status === "closed" ? [{ type: "notify" as const, open: true }] : []
  const next = move(state, open, props.defer)

  if (
    next.state === state &&
    state.control === control &&
    state.touched === touched &&
    state.forced === props.forceOpen &&
    notify.length === 0
  )
    return { state, effects: NO_EFFECTS }

  return {
    state: { ...next.state, control, touched, forced: props.forceOpen },
    effects: [...next.effects, ...notify],
  }
}

function move(state: DisclosureState, open: boolean, defer: boolean): DisclosureTransition {
  if (!open) {
    if (state.status === "closed") return { state, effects: NO_EFFECTS }

    const closed = {
      status: "closed",
      control: state.control,
      touched: state.touched,
      forced: state.forced,
      attempts: state.attempts,
    } as const

    return { state: closed, effects: cancel(state) }
  }

  if (state.status === "open") {
    if (defer || state.mount.phase !== "scheduled") return { state, effects: NO_EFFECTS }

    return { state: { ...state, mount: { phase: "immediate" } }, effects: cancel(state) }
  }

  if (!defer) return { state: { ...state, status: "open", mount: { phase: "immediate" } }, effects: NO_EFFECTS }
  const attempt = state.attempts + 1

  return {
    state: { ...state, status: "open", attempts: attempt, mount: { phase: "scheduled", attempt } },
    effects: [{ type: "schedule-mount", attempt, queue: "frame" }],
  }
}

function cancel(state: DisclosureState): readonly DisclosureEffect[] {
  if (state.status !== "open" || state.mount.phase !== "scheduled") return NO_EFFECTS

  return [{ type: "cancel-mount", attempt: state.mount.attempt }]
}
