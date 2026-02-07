import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"

export type VimMode = "normal" | "insert"
export type VimPending = "" | "d" | "g"

export function createVimState(input: { enabled: Accessor<boolean>; active: Accessor<boolean> }) {
  const [mode, setMode] = createSignal<VimMode>("insert")
  const [pending, setPending] = createSignal<VimPending>("")

  function clearPending() {
    if (pending()) setPending("")
  }

  function changeMode(next: VimMode) {
    clearPending()
    setMode(next)
  }

  createEffect(() => {
    const enabled = input.enabled()
    const active = input.active()

    if (!enabled || !active) {
      if (mode() !== "insert") setMode("insert")
      clearPending()
    }
  })

  return {
    mode,
    setMode: changeMode,
    pending,
    setPending,
    clearPending,
    reset() {
      clearPending()
      setMode("insert")
    },
    isInsert: createMemo(() => mode() === "insert"),
  }
}
