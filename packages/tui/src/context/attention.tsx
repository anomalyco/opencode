import type { Attention } from "@opencode/plugin/tui/context"
import { useRenderer } from "@opentui/solid"
import { createContext, onCleanup, useContext, type ParentProps } from "solid-js"
import { createTuiAttention } from "../attention"
import { useConfig } from "../config"
import { useStorage } from "./storage"

const AttentionContext = createContext<Attention>()
// Claims only need to outlive the duplicate-event window; expire them so the shared file stays small.
const CLAIM_TTL = 5 * 60_000

export function AttentionProvider(props: ParentProps) {
  const config = useConfig()
  const storage = useStorage()
  const [, updateClaims] = storage.store<{ seen: Record<string, number> }>("attention-claims", {
    initial: { seen: {} },
  })
  // Every TUI sharing a server sees every event. The storage mutation runs under a file
  // lock, so the first instance to write a key wins and the rest observe it and stay silent.
  const claim = async (key: string) => {
    let claimed = false
    try {
      await updateClaims((draft) => {
        const now = Date.now()
        for (const [id, at] of Object.entries(draft.seen)) if (now - at > CLAIM_TTL) delete draft.seen[id]
        if (draft.seen[key] !== undefined) return
        draft.seen[key] = now
        claimed = true
      })
    } catch {
      // Storage is unavailable; fail open so the alert is not lost.
      return true
    }
    return claimed
  }
  const attention = createTuiAttention({
    renderer: useRenderer(),
    config: config.data,
    claim,
  })
  onCleanup(() => attention.dispose())
  return <AttentionContext.Provider value={attention}>{props.children}</AttentionContext.Provider>
}

export function useAttention() {
  const attention = useContext(AttentionContext)
  if (!attention) throw new Error("AttentionProvider is missing")
  return attention
}
