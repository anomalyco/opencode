// An upload whose body stops advancing for this long is stuck on a dead connection; it fails instead of blocking sends.
export const UPLOAD_STALL_TIMEOUT_MS = 60_000

/** The failure a stalled upload rejects with; it carries no message, so the toast shows the generic one. */
export const UPLOAD_TIMED_OUT = Object.freeze({ reason: "timed-out" as const })

/** The draft an upload writes into, compared by identity; closing that draft cancels its uploads. */
export type UploadScope = object

export type UploadEntry = {
  readonly id: string
  readonly attempt: number
  readonly scope: UploadScope
  readonly filename: string
  readonly mime: string
  readonly size: number
  readonly loaded: number
  /**
   * Only `sending` arms the stall timer. A `queued` request may wait behind the browser's per-host connection
   * limit before its first progress event, and a `sent` body waits on the server's answer; neither is a stall.
   */
  readonly transfer: "queued" | "sending" | "sent"
}

/**
 * Every upload in flight, process-wide: uploads outlive the composer view that started them.
 * - `idle`: nothing uploads.
 * - `uploading`: `entries` is never empty, in start order.
 */
export type UploadMachineState =
  | { readonly status: "idle"; readonly issued: number }
  | { readonly status: "uploading"; readonly issued: number; readonly entries: readonly UploadEntry[] }

export type UploadMachineEvent =
  | {
      readonly type: "upload.started"
      readonly id: string
      readonly scope: UploadScope
      readonly filename: string
      readonly mime: string
      readonly size: number
    }
  | { readonly type: "upload.progress"; readonly attempt: number; readonly loaded: number }
  | { readonly type: "upload.succeeded"; readonly attempt: number; readonly path: string }
  | { readonly type: "upload.failed"; readonly attempt: number; readonly error: unknown }
  | { readonly type: "upload.timed-out"; readonly attempt: number }
  | { readonly type: "upload.cancelled"; readonly id: string }
  | { readonly type: "scope.cancelled"; readonly scope: UploadScope }

export type UploadMachineEffect =
  | { readonly type: "upload.run"; readonly attempt: number }
  | { readonly type: "timer.reset"; readonly attempt: number; readonly timeoutMs: number }
  | { readonly type: "timer.clear"; readonly attempt: number }
  | { readonly type: "upload.abort"; readonly attempt: number }
  | { readonly type: "upload.resolve"; readonly attempt: number; readonly path: string | undefined }
  | { readonly type: "upload.reject"; readonly attempt: number; readonly error: unknown }

export type UploadMachineTransition = {
  readonly state: UploadMachineState
  readonly effects: readonly UploadMachineEffect[]
}

export const INITIAL_UPLOAD_MACHINE_STATE: UploadMachineState = Object.freeze({ status: "idle", issued: 0 })

const NO_EFFECTS: readonly UploadMachineEffect[] = Object.freeze([])

const NO_ENTRIES: readonly UploadEntry[] = Object.freeze([])

export function transitionUploads(state: UploadMachineState, event: UploadMachineEvent): UploadMachineTransition {
  if (event.type === "upload.started") {
    const entries = selectUploadEntries(state)

    if (entries.some((entry) => entry.id === event.id)) return stay(state)
    const attempt = state.issued + 1

    return {
      state: {
        status: "uploading",
        issued: attempt,
        entries: [
          ...entries,
          {
            id: event.id,
            attempt,
            scope: event.scope,
            filename: event.filename,
            mime: event.mime,
            size: event.size,
            loaded: 0,
            transfer: "queued",
          },
        ],
      },
      effects: [{ type: "upload.run", attempt }],
    }
  }

  if (state.status === "idle") return stay(state)

  if (event.type === "scope.cancelled") {
    const cancelled = state.entries.filter((entry) => entry.scope === event.scope)

    if (cancelled.length === 0) return stay(state)

    return finish(
      state,
      state.entries.filter((entry) => entry.scope !== event.scope),
      cancelled.flatMap((entry) => cancel(entry.attempt)),
    )
  }

  const entry = state.entries.find((item) =>
    event.type === "upload.cancelled" ? item.id === event.id : item.attempt === event.attempt,
  )

  if (!entry) return stay(state)
  const rest = () => state.entries.filter((item) => item !== entry)

  switch (event.type) {
    case "upload.progress": {
      const loaded = Math.min(Math.max(event.loaded, entry.loaded), entry.size)
      const transfer = loaded === entry.size ? "sent" : "sending"

      if (loaded === entry.loaded && transfer === entry.transfer) return stay(state)

      return {
        state: {
          ...state,
          entries: state.entries.map((item) => (item === entry ? { ...entry, loaded, transfer } : item)),
        },
        effects:
          transfer === "sending"
            ? [{ type: "timer.reset", attempt: entry.attempt, timeoutMs: UPLOAD_STALL_TIMEOUT_MS }]
            : entry.transfer === "sending"
              ? [{ type: "timer.clear", attempt: entry.attempt }]
              : NO_EFFECTS,
      }
    }

    case "upload.succeeded":
      return finish(state, rest(), [{ type: "upload.resolve", attempt: entry.attempt, path: event.path }])
    case "upload.failed":
      return finish(state, rest(), [{ type: "upload.reject", attempt: entry.attempt, error: event.error }])
    case "upload.timed-out":
      if (entry.transfer !== "sending") return stay(state)

      return finish(state, rest(), [
        { type: "upload.abort", attempt: entry.attempt },
        { type: "upload.reject", attempt: entry.attempt, error: UPLOAD_TIMED_OUT },
      ])
    case "upload.cancelled":
      return finish(state, rest(), cancel(entry.attempt))
  }
}

export function selectUploadEntries(state: UploadMachineState) {
  return state.status === "uploading" ? state.entries : NO_ENTRIES
}

export function uploadPercent(item: Pick<UploadEntry, "loaded" | "size">) {
  return item.size === 0 ? 100 : Math.floor((item.loaded / item.size) * 100)
}

// A cancelled upload settles without its work: the work may wait where it cannot observe the abort.
function cancel(attempt: number): UploadMachineEffect[] {
  return [
    { type: "upload.abort", attempt },
    { type: "upload.resolve", attempt, path: undefined },
  ]
}

function finish(
  state: Extract<UploadMachineState, { status: "uploading" }>,
  entries: readonly UploadEntry[],
  effects: readonly UploadMachineEffect[],
): UploadMachineTransition {
  return {
    state: entries.length === 0 ? { status: "idle", issued: state.issued } : { ...state, entries },
    effects,
  }
}

function stay(state: UploadMachineState): UploadMachineTransition {
  return { state, effects: NO_EFFECTS }
}
