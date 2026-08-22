import type { Attention } from "@opencode-ai/plugin/tui/context"
import { useRenderer } from "@opentui/solid"
import { createContext, onCleanup, useContext, type ParentProps } from "solid-js"
import { createTuiAttention } from "../attention"
import { useConfig } from "../config"

const AttentionContext = createContext<Attention>()

export function AttentionProvider(props: ParentProps) {
  const config = useConfig()
  const attention = createTuiAttention({
    renderer: useRenderer(),
    config: config.data,
  })
  onCleanup(() => attention.dispose())
  return <AttentionContext.Provider value={attention}>{props.children}</AttentionContext.Provider>
}

export function useAttention() {
  const attention = useContext(AttentionContext)
  if (!attention) throw new Error("AttentionProvider is missing")
  return attention
}
