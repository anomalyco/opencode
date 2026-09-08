import { Effect } from "effect"
import { createEffect, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { SshConfig, SshItem } from "./types"
import { isSshConnecting } from "./status"

export function createSshReconnect(input: {
  items: () => readonly SshItem[]
  start: (config: SshConfig) => Promise<void>
  busy: () => boolean
  prompt: (item: SshItem, settled: () => void) => void
  error: () => void
}) {
  const [attempts, setAttempts] = createStore<
    Record<
      string,
      | {
          admitting: boolean
          prompted: boolean
          onConnected?: () => void
        }
      | undefined
    >
  >({})
  const settle = (id: string) => {
    const attempt = attempts[id]
    if (!attempt) return
    setAttempts(id, undefined)
    if (input.items().find((item) => item.config.id === id)?.stage === "ready" && attempt.onConnected)
      queueMicrotask(attempt.onConnected)
  }
  createEffect(() => {
    for (const item of input.items()) {
      const attempt = attempts[item.config.id]
      if (!attempt || attempt.admitting) continue
      if (
        item.stage === "ready" ||
        item.stage === "failed" ||
        item.stage === "disconnected" ||
        item.authenticatingElsewhere ||
        (attempt.prompted && item.stage === "authentication" && !item.prompt)
      ) {
        settle(item.config.id)
        continue
      }
      if (attempt.prompted || (!item.prompt && item.stage !== "incompatible") || input.busy()) continue
      setAttempts(item.config.id, "prompted", true)
      untrack(() => input.prompt(item, () => settle(item.config.id)))
    }
  })
  return {
    pending: (id: string) =>
      !!attempts[id]?.admitting ||
      !!input.items().find((item) => item.config.id === id)?.authenticatingElsewhere ||
      isSshConnecting(input.items().find((item) => item.config.id === id)?.stage ?? "disconnected"),
    start: (config: SshConfig, onConnected?: () => void) => {
      if (attempts[config.id] || input.items().find((item) => item.config.id === config.id)?.authenticatingElsewhere)
        return
      setAttempts(config.id, { admitting: true, prompted: false, onConnected })
      Effect.runFork(
        Effect.tryPromise(() => input.start(config)).pipe(
          Effect.tap(() => Effect.sync(() => setAttempts(config.id, "admitting", false))),
          Effect.catch(() =>
            Effect.sync(() => {
              setAttempts(config.id, undefined)
              input.error()
            }),
          ),
        ),
      )
    },
  }
}
