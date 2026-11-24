import type { WebContents } from "electron"
import { Schema } from "effect"
import {
  initialForceFocusState,
  isCurrentForceFocusAttempt,
  transitionForceFocus,
  type ForceFocusCommand,
  type ForceFocusEvent,
  type ForceFocusState,
} from "./force-focus-machine"

const focusableSelector = `
  a[href],
  button:not([disabled]),
  input:not([disabled]),
  select:not([disabled]),
  textarea:not([disabled]),
  summary,
  [contenteditable="true"],
  [tabindex]:not([tabindex="-1"])
`

// Bounds each CDP command, so a hung one cannot hold the window's later requests forever.
const COMMAND_TIMEOUT_MS = 10_000

const DocumentResult = Schema.Struct({ root: Schema.Struct({ nodeId: Schema.Number }) })

const QuerySelectorAllResult = Schema.Struct({ nodeIds: Schema.Array(Schema.Number) })

const drivers = new WeakMap<WebContents, (event: ForceFocusEvent) => void>()

export function setForceFocus(contents: WebContents, enabled: boolean) {
  if (contents.isDestroyed()) return enabled ? Promise.reject(new Error("Window closed")) : Promise.resolve()
  const dispatch = drivers.get(contents) ?? createDriver(contents)

  return new Promise<void>((resolve, reject) =>
    dispatch({ type: "request", request: { enabled, reply: { resolve, reject } } }),
  )
}

// Runs one window's force focus machine. Events queue while a transition runs its commands, so an event a command
// raises synchronously sees the state that command belongs to.
function createDriver(contents: WebContents) {
  const debuggerApi = contents.debugger
  const queue: ForceFocusEvent[] = []
  let state: ForceFocusState = initialForceFocusState
  let timer: ReturnType<typeof setTimeout> | undefined
  let draining = false

  const dispatch = (event: ForceFocusEvent) => {
    queue.push(event)

    if (draining) return

    draining = true

    for (let next = queue.shift(); next; next = queue.shift()) {
      const result = transitionForceFocus(state, next)
      state = result.state
      result.commands.forEach(run)
    }

    draining = false
  }

  const onDetach = () => dispatch({ type: "debugger.detached" })

  // The machine already counts its own detach; only another client's detach is an event.
  const detach = () => {
    if (!debuggerApi.isAttached()) return
    debuggerApi.off("detach", onDetach)
    debuggerApi.detach()
    debuggerApi.on("detach", onDetach)
  }

  const arm = (attempt: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => dispatch({ type: "timed-out", attempt }), COMMAND_TIMEOUT_MS)
  }

  const enable = async (attempt: number) => {
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach("1.3")
      dispatch({ type: "debugger.attached", attempt })
    }

    await debuggerApi.sendCommand("DOM.enable")
    await debuggerApi.sendCommand("CSS.enable")

    const document = Schema.decodeUnknownSync(DocumentResult)(
      await debuggerApi.sendCommand("DOM.getDocument", { depth: -1, pierce: true }),
    )

    const nodes = Schema.decodeUnknownSync(QuerySelectorAllResult)(
      await debuggerApi.sendCommand("DOM.querySelectorAll", {
        nodeId: document.root.nodeId,
        selector: focusableSelector,
      }),
    )

    // A timed-out or superseded attempt must not force styles the machine no longer tracks.
    if (!isCurrentForceFocusAttempt(state, attempt)) return nodes.nodeIds
    await Promise.allSettled(
      nodes.nodeIds.map((nodeId) =>
        debuggerApi.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["focus", "focus-visible"] }),
      ),
    )

    return nodes.nodeIds
  }

  const disable = async (command: Extract<ForceFocusCommand, { type: "disable" }>) => {
    await Promise.allSettled(
      command.nodeIds.map((nodeId) =>
        debuggerApi.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] }),
      ),
    )

    // A later attempt may have attached the debugger again by now.
    if (command.owned && isCurrentForceFocusAttempt(state, command.attempt)) detach()
  }

  const run = (command: ForceFocusCommand) => {
    switch (command.type) {
      case "enable":
        arm(command.attempt)

        return void enable(command.attempt).then(
          (nodeIds) => dispatch({ type: "enable.succeeded", attempt: command.attempt, nodeIds }),
          (cause) =>
            dispatch({
              type: "enable.failed",
              attempt: command.attempt,
              error: cause instanceof Error ? cause : new Error(String(cause)),
            }),
        )
      case "disable":
        arm(command.attempt)

        return void disable(command).then(() => dispatch({ type: "disable.settled", attempt: command.attempt }))
      case "detach":
        return detach()
      case "cancel-timer":
        clearTimeout(timer)
        timer = undefined

        return
      case "settle":
        return command.replies.forEach((reply) => (command.error ? reply.reject(command.error) : reply.resolve()))
    }
  }

  debuggerApi.on("detach", onDetach)
  contents.once("destroyed", () => {
    debuggerApi.off("detach", onDetach)
    dispatch({ type: "destroyed" })
  })
  drivers.set(contents, dispatch)

  return dispatch
}
