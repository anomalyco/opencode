import { createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import {
  selectMcpSignInView,
  startMcpSignIn,
  transitionMcpSignIn,
  type McpSignInAttemptStatus,
  type McpSignInEffect,
  type McpSignInEvent,
} from "./machine"

export type { McpSignInAttemptStatus, McpSignInFailure, McpSignInView } from "./machine"

/** The server and host calls of one MCP sign-in; the app and the details plugin bind them to their own SDK. */
export type McpSignInHost = {
  /** The authorization URL the browser opens. */
  url: string
  /** The attempt's lifetime in milliseconds, from the server's `time`; the two clocks may disagree. */
  lifetime: number
  /** Polls the attempt's status. */
  status: (signal: AbortSignal) => Promise<McpSignInAttemptStatus>
  /** Sends a redirect URL pasted from the browser. */
  complete: (code: string, signal: AbortSignal) => Promise<unknown>
  /** Ends the attempt on the server. */
  cancel: () => Promise<unknown>
  /** Reloads the MCP server and resource lists after the sign-in succeeded. */
  sync: () => Promise<void>
  openExternal: (url: string) => void
  /** Closes the dialog once the lists reloaded. */
  close: () => void
  /** The text shown for a failed request. */
  message: (error: unknown) => string
}

/**
 * Drives an MCP sign-in dialog's machine for the owner's lifetime: polls the attempt, sends a pasted redirect URL,
 * reloads the MCP lists once it succeeded, and cancels an attempt still open when the owner is disposed.
 */
export function createMcpSignIn(host: McpSignInHost) {
  const initial = startMcpSignIn({ url: host.url, lifetimeMs: host.lifetime })
  const [signInState, setSignInState] = createSignal(initial.state)
  const view = createMemo(() => selectMcpSignInView(signInState()))
  // The machine decides when each of these starts and stops; the driver only holds them.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let pollController: AbortController | undefined
  let submitController: AbortController | undefined

  const dispatch = (event: McpSignInEvent) => {
    const previous = untrack(signInState)
    const next = transitionMcpSignIn(previous, event)

    if (next.state !== previous) setSignInState(next.state)
    next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch((cause) => console.error(cause)))
  }

  const run = (effect: McpSignInEffect) => {
    if (effect.type === "deadline.start") {
      clearTimeout(deadlineTimer)
      deadlineTimer = setTimeout(() => dispatch({ type: "waiting.timed-out" }), effect.delayMs)

      return
    }

    if (effect.type === "deadline.clear") return clearTimeout(deadlineTimer)

    if (effect.type === "poll") {
      abortPoll()

      if (effect.delayMs <= 0) return poll(effect.pollAttempt)
      pollTimer = setTimeout(() => poll(effect.pollAttempt), effect.delayMs)

      return
    }

    if (effect.type === "poll.abort") return abortPoll()

    if (effect.type === "submit") {
      submitController?.abort()
      const controller = new AbortController()
      submitController = controller
      void Promise.try(() => host.complete(effect.code, controller.signal)).then(
        () => {
          if (!controller.signal.aborted) dispatch({ type: "submit.succeeded", submitAttempt: effect.submitAttempt })
        },
        (error) => {
          if (controller.signal.aborted) return
          dispatch({ type: "submit.failed", submitAttempt: effect.submitAttempt, message: host.message(error) })
        },
      )

      return
    }

    if (effect.type === "submit.abort") {
      submitController?.abort()
      submitController = undefined

      return
    }

    if (effect.type === "sync") {
      clearTimeout(syncTimer)
      syncTimer = setTimeout(() => dispatch({ type: "sync.timed-out", syncAttempt: effect.syncAttempt }), effect.timeoutMs)
      void Promise.try(host.sync).then(
        () => dispatch({ type: "sync.succeeded", syncAttempt: effect.syncAttempt }),
        (error) => dispatch({ type: "sync.failed", syncAttempt: effect.syncAttempt, message: host.message(error) }),
      )

      return
    }

    if (effect.type === "sync.clear") return clearTimeout(syncTimer)

    if (effect.type === "refresh") return void Promise.try(host.sync).catch(() => undefined)

    if (effect.type === "open-external") return host.openExternal(effect.url)

    if (effect.type === "cancel") return void Promise.try(host.cancel).catch(() => undefined)

    host.close()
  }

  const poll = (pollAttempt: number) => {
    const controller = new AbortController()
    pollController = controller
    void Promise.try(() => host.status(controller.signal)).then(
      (status) => {
        if (controller.signal.aborted) return
        dispatch({
          type: "polled",
          pollAttempt,
          outcome:
            status.status === "failed" ? { status: "failed", message: status.message } : { status: status.status },
        })
      },
      (error) => {
        if (controller.signal.aborted) return
        dispatch({ type: "polled", pollAttempt, outcome: { status: "unreachable", message: host.message(error) } })
      },
    )
  }

  const abortPoll = () => {
    clearTimeout(pollTimer)
    pollController?.abort()
    pollController = undefined
  }

  onMount(() => initial.effects.forEach(run))
  onCleanup(() => dispatch({ type: "disposed" }))

  return { view, dispatch }
}
