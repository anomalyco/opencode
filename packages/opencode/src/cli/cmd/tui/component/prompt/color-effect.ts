import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { resolvePromptBarOverlay, type PromptBarVisualTheme } from "@tui/util/prompt-bar-visual"
import type { PromptBarState } from "@tui/util/prompt-bar-state"

export function usePromptBarColorEffect(props: {
  visible: () => boolean
  state: () => PromptBarState
  hasContent: () => boolean
  animationsEnabled: () => boolean
  theme: PromptBarVisualTheme
  requestRender: () => void
}) {
  const [idleCycleIndex, setIdleCycleIndex] = createSignal(0)
  const idleCycleEnabled = createMemo(() => {
    if (!props.visible()) return false
    if (props.state() !== "idle") return false
    if (props.hasContent()) return false
    return props.animationsEnabled()
  })

  createEffect(() => {
    if (!idleCycleEnabled()) {
      if (idleCycleIndex() !== 0) setIdleCycleIndex(0)
      return
    }

    const timer = setInterval(() => {
      if (!idleCycleEnabled()) return
      setIdleCycleIndex((x) => x + 1)
      props.requestRender()
    }, 1000)

    onCleanup(() => clearInterval(timer))
  })

  const background = createMemo(() =>
    resolvePromptBarOverlay({
      state: props.state(),
      hasContent: props.hasContent(),
      idleCycleIndex: idleCycleIndex(),
      idleCycleEnabled: idleCycleEnabled(),
      theme: props.theme,
    }),
  )

  return { background }
}
