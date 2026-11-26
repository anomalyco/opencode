/** One dialog a plugin opened, from `ctx.dialogs.open` until its `ended` callback runs, once. */
export type PluginDialogState =
  /** The handle exists; the open has not been requested yet. */
  | { readonly status: "created" }
  /** Waits for the app interface to mount, so it never shows behind the startup screen. */
  | { readonly status: "waiting" }
  /** Handed to the dialog stack, which mounts it in a later transition. */
  | { readonly status: "shown" }
  | { readonly status: "closed" }

export type PluginDialogEvent =
  /** `aborted`: the plugin, or the scope that opened the dialog, already went away. */
  | { readonly type: "open"; readonly aborted: boolean }
  | { readonly type: "mounted" }
  /** The handle's `close`, the plugin or scope going away, or the content failing to render. */
  | { readonly type: "close" }
  /** The stack closed or dropped the dialog: Escape, a click outside, a replacing dialog, or its root going away. */
  | { readonly type: "dismissed" }

export type PluginDialogEffect =
  /** Ties the dialog to the plugin or scope that opened it. */
  | { readonly type: "register" }
  | { readonly type: "release" }
  | { readonly type: "wait" }
  | { readonly type: "cancel" }
  | { readonly type: "show" }
  /** Keeps a deferred open from mounting or replacing another dialog. */
  | { readonly type: "abort" }
  | { readonly type: "close" }
  | { readonly type: "ended" }

export type PluginDialogTransition = {
  readonly state: PluginDialogState
  readonly effects: readonly PluginDialogEffect[]
}

const created: PluginDialogState = { status: "created" }

const waiting: PluginDialogState = { status: "waiting" }

const shown: PluginDialogState = { status: "shown" }

const closed: PluginDialogState = { status: "closed" }

export function createPluginDialogState() {
  return created
}

export function transitionPluginDialog(state: PluginDialogState, event: PluginDialogEvent): PluginDialogTransition {
  if (state.status === "created") {
    if (event.type !== "open") return step(state)

    if (event.aborted) return step(closed, [{ type: "ended" }])

    return step(waiting, [{ type: "register" }, { type: "wait" }])
  }

  if (state.status === "waiting") {
    if (event.type === "mounted") return step(shown, [{ type: "show" }])

    if (event.type === "close") return step(closed, [{ type: "cancel" }, { type: "release" }, { type: "ended" }])

    return step(state)
  }

  if (state.status === "shown") {
    // An open the stack has not mounted yet is aborted; a mounted one closes by its own id, never the top one.
    if (event.type === "close")
      return step(closed, [{ type: "abort" }, { type: "close" }, { type: "release" }, { type: "ended" }])

    if (event.type === "dismissed") return step(closed, [{ type: "release" }, { type: "ended" }])

    return step(state)
  }

  return step(state)
}

function step(state: PluginDialogState, effects: readonly PluginDialogEffect[] = []): PluginDialogTransition {
  return { state, effects }
}
