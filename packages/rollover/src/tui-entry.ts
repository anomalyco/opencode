/** TUI plugin entry: toast bridge (decision D3, spec §8.6). */
import path from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import { rolloverToast } from "./core/messages"
import { estimateTokens } from "./core/tokens"
import type { SessionState } from "./core/types"
import { RolloverDefinition } from "./rpc"

const DEFAULT_POLL_MS = 1000

export default Plugin.define({
  id: "rollover-toast",
  setup: (context) => {
    const pollMs =
      typeof context.options.pollMs === "number" && context.options.pollMs > 0
        ? context.options.pollMs
        : DEFAULT_POLL_MS
    const shown = new Map<string, number>()
    let running = false

    const check = async () => {
      if (running) return
      running = true
      try {
        const directory = context.location?.directory
        if (!directory) return
        for (const session of context.data.session.list()) {
          const file = Bun.file(path.join(directory, ".opencode", "rollover", session.id, "state.json"))
          if (!(await file.exists())) continue
          const state = (await file.json()) as SessionState
          const last = state.lastRollover
          if (!last || shown.get(session.id) === last.at) continue
          shown.set(session.id, last.at)
          context.ui.toast.show({
            message: rolloverToast({
              tokensBefore: last.before,
              tokensAfter: last.after,
              renderTokens: last.renderTokens ?? estimateTokens(state.rollover?.renderText ?? ""),
              tailTokens: last.tailTokens ?? 0,
            }),
            variant: "info",
            sessionID: session.id,
          })
        }
      } catch (error) {
        console.error(`[rollover] toast bridge failed: ${String(error)}`)
      } finally {
        running = false
      }
    }

    const timer = setInterval(() => {
      void check()
    }, pollMs)
    void check()

    // Command output: the server plugin publishes /rollover results on its
    // RPC and the command succeeds, so this is the only feedback a TUI user
    // gets for the command (decision D3's toast channel).
    const offNotify = context.client.rpc(RolloverDefinition).events.on("notify", (event) => {
      context.ui.toast.show({ title: "Rollover", message: event.data.text })
    })

    return () => {
      clearInterval(timer)
      offNotify()
    }
  },
})
