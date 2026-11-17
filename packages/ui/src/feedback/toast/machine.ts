export type ToastRegistryEntry<O> = {
  readonly id: number
  /** Same title, description, variant, timing and action labels coalesce into one toast. */
  readonly key: string
  readonly options: O
}

/**
 * The toasts `showToast` and `toaster` have published and not yet seen close. Each entry lives from its publish
 * until solid-sonner reports it closed (`onDismiss`, `onAutoClose`), `toaster.dismiss` closes it, or a later show
 * finds it missing from solid-sonner's live toasts.
 */
export type ToastRegistryState<O> = {
  /** Last allocated id. IDs count down from `-1`: solid-sonner treats a falsy id as "dismiss every toast". */
  readonly nextId: number
  readonly entries: readonly ToastRegistryEntry<O>[]
}

export type ToastShownEvent<O> = {
  readonly type: "toast.shown"
  readonly key: string
  readonly options: O
  /** IDs solid-sonner still holds, from `toast.getToasts()`, which also lists toasts other code shows. */
  readonly liveIds: ReadonlySet<number | string>
  /** The newest of them, shown in front. */
  readonly topmostLiveId: number | string | undefined
}

export type ToastRegistryEvent<O> =
  | { readonly type: "custom.shown" }
  | ToastShownEvent<O>
  | { readonly type: "toast.released"; readonly id: number }
  | { readonly type: "toast.dismissed"; readonly id?: number }

export type ToastRegistryEffect<O> =
  | { readonly type: "sonner.publish"; readonly id: number; readonly options: O }
  | { readonly type: "sonner.dismiss"; readonly id?: number }
  | { readonly type: "dom.pulse"; readonly id: number }

export type ToastRegistryTransition<O> = {
  readonly state: ToastRegistryState<O>
  /** The toast a `toast.shown` event showed. */
  readonly id?: number
  readonly effects: readonly ToastRegistryEffect<O>[]
}

export function createToastRegistryState<O>(): ToastRegistryState<O> {
  return { nextId: 0, entries: [] }
}

export function transitionToastRegistry<O>(
  state: ToastRegistryState<O>,
  event: ToastShownEvent<O>,
): ToastRegistryTransition<O> & { readonly id: number }
export function transitionToastRegistry<O>(
  state: ToastRegistryState<O>,
  event: ToastRegistryEvent<O>,
): ToastRegistryTransition<O>
export function transitionToastRegistry<O>(
  state: ToastRegistryState<O>,
  event: ToastRegistryEvent<O>,
): ToastRegistryTransition<O> {
  // A custom toast only takes an id: its caller owns its content and dismisses it through `toaster.dismiss`.
  if (event.type === "custom.shown") return { state: { ...state, nextId: state.nextId - 1 }, effects: [] }

  if (event.type === "toast.released") return { state: remove(state, event.id), effects: [] }

  if (event.type === "toast.dismissed") {
    const next = event.id === undefined ? { nextId: state.nextId, entries: [] } : remove(state, event.id)

    return { state: next, effects: [{ type: "sonner.dismiss", id: event.id }] }
  }

  // An entry solid-sonner no longer holds was dismissed behind the registry's back.
  const live = state.entries.filter((entry) => event.liveIds.has(entry.id))
  const match = live.find((entry) => entry.key === event.key)

  // The same toast is still in front: update it in place and pulse it rather than stacking a copy.
  if (match && match.id === event.topmostLiveId) {
    return {
      state: {
        nextId: state.nextId,
        entries: live.map((entry) => (entry === match ? { ...entry, options: event.options } : entry)),
      },
      id: match.id,
      effects: [
        { type: "sonner.publish", id: match.id, options: event.options },
        { type: "dom.pulse", id: match.id },
      ],
    }
  }

  // A buried copy moves to the front as a new toast.
  const id = state.nextId - 1
  const rest = match ? live.filter((entry) => entry !== match) : live

  return {
    state: { nextId: id, entries: [...rest, { id, key: event.key, options: event.options }] },
    id,
    effects: [
      ...(match ? [{ type: "sonner.dismiss", id: match.id } as const] : []),
      { type: "sonner.publish", id, options: event.options },
    ],
  }
}

export function selectToastOptions<O>(state: ToastRegistryState<O>, id: number) {
  return state.entries.find((entry) => entry.id === id)?.options
}

function remove<O>(state: ToastRegistryState<O>, id: number) {
  if (!state.entries.some((entry) => entry.id === id)) return state

  return { nextId: state.nextId, entries: state.entries.filter((entry) => entry.id !== id) }
}
