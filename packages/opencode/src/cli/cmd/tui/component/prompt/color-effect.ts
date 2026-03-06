import {
  resolvePromptBarAnimationBackground,
  resolvePromptBarAnimationPlugin,
} from "@tui/util/prompt-bar-animation-registry"
import type { PromptBarAnimationPlugin } from "@tui/util/prompt-bar-animation-plugin"
import type { PromptBarState } from "@tui/util/prompt-bar-state"
import type { PromptBarVisualTheme } from "@tui/util/prompt-bar-visual"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"

export function usePromptBarColorEffect(props: {
  visible: () => boolean
  state: () => PromptBarState
  hasContent: () => boolean
  animationsEnabled: () => boolean
  pluginEnabled: () => boolean
  plugin: () => PromptBarAnimationPlugin
  theme: PromptBarVisualTheme
  requestRender: () => void
}) {
  const fallback = resolvePromptBarAnimationPlugin()
  const [idleCycleIndex, setIdleCycleIndex] = createSignal(0)
  const interval = createMemo(() => Math.max(0, props.plugin().interval_ms))
  const idleCycleEnabled = createMemo(() => {
    if (!props.visible()) return false
    if (!props.pluginEnabled()) return false
    if (props.state() !== "idle") return false
    if (props.hasContent()) return false
    return props.animationsEnabled()
  })

  createEffect(() => {
    if (!idleCycleEnabled()) {
      if (idleCycleIndex() !== 0) setIdleCycleIndex(0)
      return
    }
    if (interval() === 0) return

    const timer = setInterval(() => {
      if (!idleCycleEnabled()) return
      setIdleCycleIndex((x) => x + 1)
      props.requestRender()
    }, interval())

    onCleanup(() => clearInterval(timer))
  })

  const background = createMemo(() =>
    props.pluginEnabled()
      ? resolvePromptBarAnimationBackground({
          plugin: props.plugin(),
          fallback,
          data: {
            state: props.state(),
            hasContent: props.hasContent(),
            idleCycleIndex: idleCycleIndex(),
            idleCycleEnabled: idleCycleEnabled(),
            theme: props.theme,
          },
        })
      : undefined,
  )

  return { background }
}
