/** How long a dialog stays mounted once it starts closing, unless its layer asks for longer. */
export const DIALOG_EXIT_MS = 100

/**
 * `attempt` identifies one mount, so a reused caller `id` never collides with a layer that is still closing. `focus` is
 * where focus returns: where it was before this dialog opened, or before the dialogs it replaced opened. `replaced`
 * holds the attempts of the open dialogs this one replaced through `show`, and theirs in turn, so a close from inside
 * one of them closes this dialog.
 */
export type DialogOpenEntry<F = unknown> = {
  readonly status: "open"
  readonly attempt: number
  readonly id: string
  readonly exitMs: number
  readonly backdropDismiss: boolean
  readonly focus: F | undefined
  readonly replaced: readonly number[]
}

/** Waits for its exit animation. It keeps `focus` so a `show` that replaces it still returns focus to the origin. */
export type DialogClosingEntry<F = unknown> = {
  readonly status: "closing"
  readonly attempt: number
  readonly id: string
  readonly focus: F | undefined
  readonly replaced: readonly number[]
}

export type DialogEntry<F = unknown> = DialogOpenEntry<F> | DialogClosingEntry<F>

export type DialogStackState<F = unknown> =
  | { readonly status: "active"; readonly issued: number; readonly entries: readonly DialogEntry<F>[] }
  | { readonly status: "disposed"; readonly issued: number }

/** `request` is the driver's content for the open; the machine only hands it back in `mount` or `discard`. */
export type DialogStackEvent<F = unknown, R = unknown> =
  | {
      readonly type: "open"
      readonly mode: "show" | "push"
      readonly id: string
      readonly aborted: boolean
      readonly focus: F | undefined
      readonly request: R
    }
  /**
   * With `id`, closes the newest open dialog with that id. Without one, `layer` is the attempt of the dialog that asked:
   * that dialog closes itself, even under a dialog that is still exiting, or the dialog that replaced it through `show`.
   * Once that dialog is gone, a late close (after an await) closes nothing. A close from outside every dialog closes the
   * newest dialog. Both close one at a time: while the target plays its exit animation, a second close (a double click,
   * a callback closing again) closes nothing below it.
   */
  | { readonly type: "close"; readonly id?: string; readonly layer?: number }
  /** Escape, or a dismissal that applies only while `id` is the top open dialog. */
  | { readonly type: "dismiss"; readonly id?: string }
  /** A click on one layer's backdrop. */
  | { readonly type: "backdrop.click"; readonly attempt: number }
  /** Kobalte asking one layer to close, as its close button does. */
  | { readonly type: "layer.dismiss"; readonly attempt: number }
  | { readonly type: "layer.backdrop-dismiss"; readonly attempt: number; readonly enabled: boolean }
  | { readonly type: "layer.exit-duration"; readonly attempt: number; readonly exitMs: number }
  | { readonly type: "exit.completed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type DialogStackEffect<F = unknown, R = unknown> =
  | { readonly type: "mount"; readonly attempt: number; readonly id: string; readonly request: R }
  | { readonly type: "discard"; readonly request: R; readonly notify: boolean }
  | { readonly type: "timer.start"; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "timer.stop"; readonly attempt: number }
  | { readonly type: "notify.close"; readonly attempt: number }
  | { readonly type: "focus.return"; readonly attempt: number; readonly focus: F | undefined }
  | { readonly type: "dispose"; readonly attempt: number; readonly notify: boolean }

export type DialogStackTransition<F = unknown, R = unknown> = {
  readonly state: DialogStackState<F>
  readonly effects: readonly DialogStackEffect<F, R>[]
}

export function createDialogStackState<F = unknown>(): DialogStackState<F> {
  return { status: "active", issued: 0, entries: [] }
}

export function transitionDialogStack<F, R>(
  state: DialogStackState<F>,
  event: DialogStackEvent<F, R>,
): DialogStackTransition<F, R> {
  if (event.type === "open") return open(state, event)

  if (state.status === "disposed") return { state, effects: [] }

  if (event.type === "disposed") {
    return {
      state: { status: "disposed", issued: state.issued },
      effects: state.entries.flatMap((entry) => teardown<F, R>(entry, false)),
    }
  }

  if (event.type === "exit.completed") {
    const entry = state.entries.find((item) => item.attempt === event.attempt)

    if (entry?.status !== "closing") return { state, effects: [] }

    return {
      state: { ...state, entries: state.entries.filter((item) => item !== entry) },
      effects: [{ type: "dispose", attempt: entry.attempt, notify: false }],
    }
  }

  if (event.type === "layer.backdrop-dismiss") {
    return update(state, event.attempt, (entry) =>
      entry.backdropDismiss === event.enabled ? entry : { ...entry, backdropDismiss: event.enabled },
    )
  }

  if (event.type === "layer.exit-duration") {
    const exitMs = Math.max(0, event.exitMs)

    return update(state, event.attempt, (entry) => (entry.exitMs === exitMs ? entry : { ...entry, exitMs }))
  }

  const target = closeTarget(state, event)

  if (!target) return { state, effects: [] }

  return beginClose(state, target)
}

/** The top dialog that is open. One that started closing no longer counts, though it waits to be disposed. */
export function selectTopDialog<F>(state: DialogStackState<F>) {
  if (state.status === "disposed") return undefined

  return state.entries.findLast((entry): entry is DialogOpenEntry<F> => entry.status === "open")
}

/** True from the moment a layer starts closing, through its exit animation, and once it is gone. */
export function selectLayerClosing<F>(state: DialogStackState<F>, attempt: number) {
  if (state.status === "disposed") return true

  return state.entries.find((entry) => entry.attempt === attempt)?.status !== "open"
}

/** Stacked dialogs render as sibling portals, so only the top open layer may own the focus trap. */
export function selectLayerModal<F>(state: DialogStackState<F>, attempt: number, contained: boolean) {
  return !contained && selectTopDialog(state)?.attempt === attempt
}

/** The layer's place in the stack, so a newer dialog always renders above. */
export function selectLayerIndex<F>(state: DialogStackState<F>, attempt: number) {
  if (state.status === "disposed") return 0

  return Math.max(
    0,
    state.entries.findIndex((entry) => entry.attempt === attempt),
  )
}

function open<F, R>(
  state: DialogStackState<F>,
  event: Extract<DialogStackEvent<F, R>, { type: "open" }>,
): DialogStackTransition<F, R> {
  // An open whose signal aborted neither mounts nor replaces anything; its caller hears onClose as a replaced one would.
  if (event.aborted) return { state, effects: [{ type: "discard", request: event.request, notify: true }] }

  // A deferred open must not mount after the provider is gone.
  if (state.status === "disposed") return { state, effects: [{ type: "discard", request: event.request, notify: false }] }
  const attempt = state.issued + 1
  const replace = event.mode === "show"
  const first = state.entries[0]

  const entry: DialogOpenEntry<F> = {
    status: "open",
    attempt,
    id: event.id,
    exitMs: DIALOG_EXIT_MS,
    backdropDismiss: true,
    // A replacement returns focus to where the dialogs it replaces would have, not to their now-removed content.
    focus: replace && first ? first.focus : event.focus,
    // A dialog that had already started closing was not replaced: a late close from inside it still closes nothing.
    replaced: replace
      ? state.entries.flatMap((item) => (item.status === "open" ? [item.attempt, ...item.replaced] : []))
      : [],
  }

  const mount: DialogStackEffect<F, R> = { type: "mount", attempt, id: event.id, request: event.request }

  if (!replace) return { state: { ...state, issued: attempt, entries: [...state.entries, entry] }, effects: [mount] }

  return {
    state: { ...state, issued: attempt, entries: [entry] },
    effects: [...state.entries.flatMap((item) => teardown<F, R>(item, true)), mount],
  }
}

function closeTarget<F>(
  state: Extract<DialogStackState<F>, { status: "active" }>,
  event: Extract<
    DialogStackEvent<F>,
    { type: "close" } | { type: "dismiss" } | { type: "backdrop.click" } | { type: "layer.dismiss" }
  >,
) {
  const top = selectTopDialog(state)

  if (event.type === "close") {
    if (event.id !== undefined) {
      return state.entries.findLast(
        (entry): entry is DialogOpenEntry<F> => entry.status === "open" && entry.id === event.id,
      )
    }

    const layer = event.layer

    const target =
      layer === undefined
        ? state.entries.at(-1)
        : state.entries.find((entry) => entry.attempt === layer || entry.replaced.includes(layer))

    return target?.status === "open" ? target : undefined
  }

  if (event.type === "dismiss") return event.id === undefined || top?.id === event.id ? top : undefined

  if (top?.attempt !== event.attempt) return undefined

  if (event.type === "backdrop.click" && !top.backdropDismiss) return undefined

  return top
}

/** The exit timer starts first, so the dialog still goes away when its onClose throws. */
function beginClose<F, R>(
  state: Extract<DialogStackState<F>, { status: "active" }>,
  target: DialogOpenEntry<F>,
): DialogStackTransition<F, R> {
  // Only the top open dialog holds focus. It returns after onClose, so focus that onClose moved elsewhere stays there,
  // and before close() returns, as a native dialog's does, so an action that runs after closing can move it on.
  const top = selectTopDialog(state)?.attempt === target.attempt

  const closing: DialogClosingEntry<F> = {
    status: "closing",
    attempt: target.attempt,
    id: target.id,
    focus: target.focus,
    replaced: target.replaced,
  }

  return {
    state: { ...state, entries: state.entries.map((entry) => (entry === target ? closing : entry)) },
    effects: [
      { type: "timer.start", attempt: target.attempt, delayMs: target.exitMs },
      { type: "notify.close", attempt: target.attempt },
      ...(top ? [{ type: "focus.return" as const, attempt: target.attempt, focus: target.focus }] : []),
    ],
  }
}

/** A dialog that is already closing heard onClose when it started to; it does not hear it again. */
function teardown<F, R>(entry: DialogEntry<F>, notify: boolean): DialogStackEffect<F, R>[] {
  if (entry.status === "open") return [{ type: "dispose", attempt: entry.attempt, notify }]

  return [
    { type: "timer.stop", attempt: entry.attempt },
    { type: "dispose", attempt: entry.attempt, notify: false },
  ]
}

function update<F, R>(
  state: Extract<DialogStackState<F>, { status: "active" }>,
  attempt: number,
  change: (entry: DialogOpenEntry<F>) => DialogOpenEntry<F>,
): DialogStackTransition<F, R> {
  const entry = state.entries.find(
    (item): item is DialogOpenEntry<F> => item.attempt === attempt && item.status === "open",
  )

  if (!entry) return { state, effects: [] }
  const next = change(entry)

  if (next === entry) return { state, effects: [] }

  return { state: { ...state, entries: state.entries.map((item) => (item === entry ? next : item)) }, effects: [] }
}
