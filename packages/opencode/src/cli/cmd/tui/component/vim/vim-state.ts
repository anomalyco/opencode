import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"

export type VimMode = "normal" | "insert"

export function createVimState(input: { enabled: Accessor<boolean>; active: Accessor<boolean> }) {
  const [mode, setMode] = createSignal<VimMode>("insert")

  createEffect(() => {
    const enabled = input.enabled()
    const active = input.active()

    if (!enabled || !active) {
      if (mode() !== "insert") setMode("insert")
    }
  })

  return {
    mode,
    setMode,
    reset() {
      setMode("insert")
    },
    isInsert: createMemo(() => mode() === "insert"),
  }
}
