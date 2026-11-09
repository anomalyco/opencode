/**
 * Lifecycle of one persisted store. `last` is the serialized value storage is known to hold, so a save
 * that serializes to it writes nothing. `remote` is the newest value another window wrote while a local
 * edit was unsaved. `baseline` is the store serialized just before the first edit made while loading:
 * a save that still serializes to it made no real change, so the loaded or remote value wins.
 */
export type PersistStoreState =
  | {
      readonly status: "hydrating"
      readonly edit: { readonly baseline: string; readonly remote: string | undefined } | undefined
    }
  | { readonly status: "clean"; readonly last: string | undefined }
  | {
      readonly status: "dirty"
      readonly last: string | undefined
      readonly remote: string | undefined
      readonly baseline: string | undefined
    }
  | { readonly status: "disposed" }

export type PersistStoreEvent =
  | { readonly type: "init.resolved"; readonly raw: string | null }
  | { readonly type: "init.failed" }
  /** `baseline` is present only for the first edit while hydrating. */
  | { readonly type: "edited"; readonly baseline: string | undefined }
  | { readonly type: "remote.received"; readonly raw: string }
  | { readonly type: "flushed"; readonly serialized: string }
  /** `fallback` is what storage held before the failed write of `attempted`. */
  | { readonly type: "write.failed"; readonly attempted: string; readonly fallback: string | undefined }
  /** `serialized` is present when the store had an unsaved edit at disposal. */
  | { readonly type: "disposed"; readonly serialized: string | undefined }

export type PersistStoreEffect =
  | { readonly type: "hydrate"; readonly raw: string }
  | { readonly type: "schedule-save" }
  /** Broadcast to other windows, then write; `fallback` rolls `last` back if the write fails. */
  | { readonly type: "save"; readonly serialized: string; readonly fallback: string | undefined }

export type PersistStoreTransition = {
  readonly state: PersistStoreState
  readonly effects: readonly PersistStoreEffect[]
}

const EMPTY_EFFECTS: readonly PersistStoreEffect[] = Object.freeze([])

const SCHEDULE: readonly PersistStoreEffect[] = Object.freeze([{ type: "schedule-save" }])

const HYDRATING: PersistStoreState = Object.freeze({ status: "hydrating", edit: undefined })

const DISPOSED: PersistStoreState = Object.freeze({ status: "disposed" })

/** The state for a store whose `getItem` returned `init`: a pending load, or the stored value. */
export function createPersistStoreState(init: { readonly async: true } | { readonly raw: string | null }) {
  if ("async" in init) return { state: HYDRATING, effects: EMPTY_EFFECTS }

  return loaded(init.raw)
}

export function transitionPersistStore(state: PersistStoreState, event: PersistStoreEvent): PersistStoreTransition {
  const same = { state, effects: EMPTY_EFFECTS }

  if (state.status === "disposed") return same

  if (event.type === "disposed") return dispose(state, event.serialized)

  if (state.status === "hydrating") {
    const edit = state.edit

    if (event.type === "init.resolved") {
      if (!edit) return loaded(event.raw)

      return dirty(event.raw || undefined, edit.remote, edit.baseline)
    }

    if (event.type === "init.failed") return edit ? dirty(undefined, edit.remote, edit.baseline) : loaded(null)

    if (event.type === "edited") {
      if (edit) return same

      return {
        state: { status: "hydrating", edit: { baseline: event.baseline ?? "", remote: undefined } },
        effects: SCHEDULE,
      }
    }

    if (event.type === "remote.received") {
      // A value another window wrote is newer than the pending load, which is dropped when it arrives.
      if (!edit) return { state: clean(event.raw), effects: [{ type: "hydrate", raw: event.raw }] }

      if (edit.remote === event.raw) return same

      return { state: { status: "hydrating", edit: { ...edit, remote: event.raw } }, effects: EMPTY_EFFECTS }
    }

    if (event.type === "flushed" && edit) {
      // A no-op edit keeps waiting for the load instead of overwriting storage with the initial value.
      if (event.serialized === edit.baseline && edit.remote === undefined)
        return { state: HYDRATING, effects: EMPTY_EFFECTS }

      return settle(edit.baseline, undefined, edit.remote, event.serialized)
    }

    return same
  }

  if (event.type === "init.resolved" || event.type === "init.failed") return same

  if (event.type === "write.failed") {
    if (state.last !== event.attempted || state.last === event.fallback) return same

    return { state: { ...state, last: event.fallback }, effects: EMPTY_EFFECTS }
  }

  if (state.status === "clean") {
    if (event.type === "edited") return { state: dirty(state.last, undefined, undefined).state, effects: SCHEDULE }

    if (event.type === "remote.received" && event.raw !== state.last) {
      return { state: clean(event.raw), effects: [{ type: "hydrate", raw: event.raw }] }
    }

    return same
  }

  if (event.type === "remote.received") {
    if (state.remote === event.raw) return same

    return { state: { ...state, remote: event.raw }, effects: EMPTY_EFFECTS }
  }

  if (event.type === "flushed") return settle(state.baseline, state.last, state.remote, event.serialized)

  return same
}

/** True once the stored value has been applied or the load settled. */
export function isPersistReady(state: PersistStoreState) {
  return state.status === "clean" || state.status === "dirty"
}

/** True when the store holds an edit that a flush must serialize. */
export function needsPersistFlush(state: PersistStoreState) {
  return state.status === "dirty" || (state.status === "hydrating" && state.edit !== undefined)
}

/** True while a pending load may still write a canonicalized or relocated value back to storage. */
export function canWriteBackHydration(state: PersistStoreState) {
  return state.status === "hydrating"
}

function clean(last: string | undefined): PersistStoreState {
  return { status: "clean", last }
}

function loaded(raw: string | null): PersistStoreTransition {
  if (!raw) return { state: clean(undefined), effects: EMPTY_EFFECTS }

  return { state: clean(raw), effects: [{ type: "hydrate", raw }] }
}

function dirty(last: string | undefined, remote: string | undefined, baseline: string | undefined) {
  return { state: { status: "dirty", last, remote, baseline } satisfies PersistStoreState, effects: EMPTY_EFFECTS }
}

/**
 * Ends an unsaved edit. A save that changed nothing (it still matches the pre-load baseline or the stored
 * value) adopts the newest remote or stored value; a real change wins over both and is written.
 */
function settle(
  baseline: string | undefined,
  last: string | undefined,
  remote: string | undefined,
  serialized: string,
): PersistStoreTransition {
  if (serialized === baseline || serialized === last) {
    const adopted = remote ?? last

    if (adopted === undefined || adopted === serialized) return { state: clean(adopted), effects: EMPTY_EFFECTS }

    return { state: clean(adopted), effects: [{ type: "hydrate", raw: adopted }] }
  }

  return { state: clean(serialized), effects: [{ type: "save", serialized, fallback: last }] }
}

function dispose(state: Exclude<PersistStoreState, { status: "disposed" }>, serialized: string | undefined) {
  if (serialized === undefined || !needsPersistFlush(state)) return { state: DISPOSED, effects: EMPTY_EFFECTS }

  // The store is gone, so a disposal only writes a real edit and never hydrates.
  const flushed = transitionPersistStore(state, { type: "flushed", serialized })

  return { state: DISPOSED, effects: flushed.effects.filter((effect) => effect.type === "save") }
}
