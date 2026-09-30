// Native menu actions can create a window before its command registry exists.
// Hold those actions until the renderer explicitly claims them, not just until
// did-finish-load (which precedes application initialization).
export function createMenuQueue<Window extends object, Command = string>(
  send: (win: Window, command: Command) => void,
) {
  const windows = new WeakMap<Window, { ready: boolean; pending: Command[] }>()
  return {
    reset(win: Window) {
      windows.set(win, { ready: false, pending: windows.get(win)?.pending ?? [] })
    },
    trigger(win: Window, id: Command) {
      const state = windows.get(win)
      if (state?.ready) return send(win, id)
      if (state) {
        state.pending.push(id)
        return
      }
      windows.set(win, { ready: false, pending: [id] })
    },
    ready(win: Window) {
      const state = windows.get(win)
      windows.set(win, { ready: true, pending: [] })
      return state?.pending ?? []
    },
  }
}
