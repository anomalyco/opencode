import { Button } from "@opencode/ui/button"
import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js"
import { useServerSDK } from "@/runtime/server/client"
import {
  createExtensionLoadState,
  extensionLoadView,
  transitionExtensionLoad,
  type ExtensionLoadEffect,
  type ExtensionLoadEvent,
} from "./extension-load-machine"
import "./workspaces/project.css"

/**
 * Reads one Settings › Extensions list for the current `key`. The read does not wait for the event stream, so a
 * server that answers HTTP while its stream reconnects still lists; the stream's reconnect reads the list again.
 */
export function createExtensionLoad<T, K>(input: { key: () => K; task: (key: K, signal: AbortSignal) => Promise<T> }) {
  const server = useServerSDK()
  const [loadState, setLoadState] = createSignal(createExtensionLoadState<T, K>())
  const runs = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const dispatch = (event: ExtensionLoadEvent<T, K>) => {
    const previous = untrack(loadState)
    const result = transitionExtensionLoad(previous, event)

    if (result.state !== previous) setLoadState(() => result.state)
    result.effects.forEach(run)
  }

  const run = (effect: ExtensionLoadEffect<K>) => {
    if (effect.type === "abort") {
      const current = runs.get(effect.attempt)
      runs.delete(effect.attempt)
      clearTimeout(current?.timer)
      current?.controller.abort()

      return
    }

    const attempt = effect.attempt
    const controller = new AbortController()
    runs.set(attempt, {
      controller,
      timer: setTimeout(() => dispatch({ type: "load.timed-out", attempt }), effect.timeoutMs),
    })
    void Promise.try(() => input.task(effect.key, controller.signal)).then(
      (value) => dispatch({ type: "load.succeeded", attempt, value }),
      () => dispatch({ type: "load.failed", attempt }),
    )
  }

  createEffect(() => {
    const key = input.key()
    untrack(() => dispatch({ type: "target.synced", key }))
  })

  createEffect(
    on(
      () => server.connection.status() === "connected",
      (connected, previous) => {
        if (connected && previous === false) dispatch({ type: "invalidated" })
      },
    ),
  )

  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    view: createMemo(() => extensionLoadView(loadState(), input.key())),
    retry: () => dispatch({ type: "retry.requested" }),
    invalidate: () => dispatch({ type: "invalidated" }),
  }
}

/** A list that failed to load, with Retry. */
export function ExtensionLoadFailed(props: { message: string; retry: string; onRetry: () => void }) {
  return (
    <div class="project-settings-extension-section-copy" role="status">
      <span class="project-settings-extension-empty-description">{props.message}</span>
      <Button variant="ghost-muted" onClick={() => props.onRetry()}>
        {props.retry}
      </Button>
    </div>
  )
}
