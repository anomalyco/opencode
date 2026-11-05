export * as BrowserProxyMachine from "./proxy-machine.js"

// The desktop proxy's listener and the read side of each tunnel socket it hands to Chromium.

export type State = { readonly status: "open" } | { readonly status: "closed" }

export type Event = { readonly type: "close" }

/** `shutdown` aborts pending connects and destroys every tunnel and client socket, once. */
export type ProxyEffect = "shutdown"

export type Transition = { readonly state: State; readonly effects: readonly ProxyEffect[] }

export const initial: State = { status: "open" }

const CLOSED: State = { status: "closed" }

export function transition(state: State, event: Event): Transition {
  if (state.status === "closed") return { state, effects: [] }

  switch (event.type) {
    case "close":
      return { state: CLOSED, effects: ["shutdown"] }
  }
}

/**
 * Whether a client connection or a tunnel that just opened may join the proxy. One that arrives
 * after `close` is destroyed instead, since shutdown already ran.
 */
export function admits(state: State) {
  return state.status === "open"
}

/**
 * One tunnel socket's read side: at most one transport read in flight, and no reads after EOF or
 * destruction.
 */
export type ReadState = "idle" | "reading" | "ended" | "destroyed"

/** Chromium pulled, a transport read answered with data or EOF, or the socket was destroyed. */
export type ReadEvent = "pull" | "chunk" | "eof" | "destroyed"

/** Returns `state` itself when the event does not apply, so callers compare to see whether to act. */
export function transitionRead(state: ReadState, event: ReadEvent): ReadState {
  if (state === "destroyed") return state

  if (event === "destroyed") return "destroyed"

  if (event === "pull") return state === "idle" ? "reading" : state

  if (state !== "reading") return state

  return event === "eof" ? "ended" : "idle"
}
