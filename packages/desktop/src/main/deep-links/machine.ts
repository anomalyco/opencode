import { consoleReturnWindow } from "../lifecycle/deep-link"

export type DeepLinkWindow = { readonly status: "loading" } | { readonly status: "ready"; readonly clientID: number }

// `target` is the window a console return names; a link without one, or whose window is gone, opens in the
// preferred window.
export type DeepLink =
  | { readonly status: "queued"; readonly url: string; readonly target: string | undefined }
  | {
      readonly status: "delivered"
      readonly url: string
      readonly target: string | undefined
      readonly clientID: number
      readonly attempt: number
    }

export type DeepLinkState = {
  readonly windows: Readonly<Record<string, DeepLinkWindow>>
  readonly focusedWindowID: string | undefined
  readonly links: readonly DeepLink[]
  readonly nextAttempt: number
}

export type DeepLinkEvent =
  | { readonly type: "links.received"; readonly urls: readonly string[] }
  | { readonly type: "window.opened"; readonly windowID: string }
  | { readonly type: "window.focused"; readonly windowID: string }
  | { readonly type: "window.ready"; readonly windowID: string; readonly clientID: number }
  | { readonly type: "window.closed"; readonly windowID: string }
  | { readonly type: "client.disconnected"; readonly clientID: number }
  | { readonly type: "delivery.acknowledged"; readonly clientID: number; readonly attempt: number }

export type DeepLinkCommand =
  | {
      readonly type: "links.deliver"
      readonly windowID: string
      readonly clientID: number
      readonly attempt: number
      readonly urls: readonly string[]
    }
  | { readonly type: "window.focus"; readonly windowID: string }

export type DeepLinkTransition = {
  readonly state: DeepLinkState
  readonly commands: readonly DeepLinkCommand[]
}

export function createDeepLinkState(): DeepLinkState {
  return { windows: {}, focusedWindowID: undefined, links: [], nextAttempt: 1 }
}

export function transitionDeepLinks(state: DeepLinkState, event: DeepLinkEvent): DeepLinkTransition {
  switch (event.type) {
    case "links.received": {
      if (event.urls.length === 0) return unchanged(state)
      const links = event.urls.map((url): DeepLink => ({ status: "queued", url, target: consoleReturnWindow(url) }))
      const focus = links.find((link) => link.target && state.windows[link.target])?.target ?? preferredWindowID(state)
      const next = drain({ ...state, links: [...state.links, ...links] })

      return {
        state: next.state,
        commands: focus ? [...next.commands, { type: "window.focus", windowID: focus }] : next.commands,
      }
    }

    case "window.opened": {
      if (state.windows[event.windowID]) return unchanged(state)

      return drain({ ...state, windows: { ...state.windows, [event.windowID]: { status: "loading" } } })
    }

    case "window.focused": {
      if (!state.windows[event.windowID] || state.focusedWindowID === event.windowID) return unchanged(state)

      return drain({ ...state, focusedWindowID: event.windowID })
    }

    case "window.ready": {
      const current = state.windows[event.windowID]

      if (current?.status === "ready" && current.clientID === event.clientID) return unchanged(state)

      return drain({
        ...state,
        windows: { ...state.windows, [event.windowID]: { status: "ready", clientID: event.clientID } },
        links: current?.status === "ready" ? requeue(state.links, current.clientID) : state.links,
      })
    }

    case "window.closed": {
      const current = state.windows[event.windowID]

      if (!current) return unchanged(state)

      return drain({
        ...state,
        windows: Object.fromEntries(Object.entries(state.windows).filter(([id]) => id !== event.windowID)),
        focusedWindowID: state.focusedWindowID === event.windowID ? undefined : state.focusedWindowID,
        links: current.status === "ready" ? requeue(state.links, current.clientID) : state.links,
      })
    }

    case "client.disconnected": {
      const windowID = Object.entries(state.windows).find(
        ([, window]) => window.status === "ready" && window.clientID === event.clientID,
      )?.[0]

      const delivered = state.links.some((link) => link.status === "delivered" && link.clientID === event.clientID)

      if (!windowID && !delivered) return unchanged(state)

      return drain({
        ...state,
        windows: windowID ? { ...state.windows, [windowID]: { status: "loading" } } : state.windows,
        links: requeue(state.links, event.clientID),
      })
    }

    case "delivery.acknowledged": {
      // An acknowledged link leaves the state, so no later renderer can receive it again.
      const links = state.links.filter(
        (link) => link.status !== "delivered" || link.clientID !== event.clientID || link.attempt !== event.attempt,
      )

      if (links.length === state.links.length) return unchanged(state)

      return { state: { ...state, links }, commands: [] }
    }
  }
}

// The window an untargeted link opens in: the focused one, else the first open one.
function preferredWindowID(state: DeepLinkState) {
  return state.focusedWindowID ?? Object.keys(state.windows)[0]
}

// The ready window and renderer a link goes to now, if any.
function recipientOf(state: DeepLinkState, link: DeepLink) {
  const windowID = link.target && state.windows[link.target] ? link.target : preferredWindowID(state)
  const window = windowID ? state.windows[windowID] : undefined

  if (!windowID || window?.status !== "ready") return

  return { windowID, clientID: window.clientID }
}

// Sends every queued link whose window is ready, one batch and attempt per window.
function drain(state: DeepLinkState): DeepLinkTransition {
  const routed = state.links.map((link) => ({
    link,
    recipient: link.status === "queued" ? recipientOf(state, link) : undefined,
  }))

  const recipients = routed.flatMap((item) => (item.recipient ? [item.recipient] : []))

  const batches = recipients
    .filter((recipient, index) => recipients.findIndex((other) => other.windowID === recipient.windowID) === index)
    .map((recipient, index) => ({
      ...recipient,
      attempt: state.nextAttempt + index,
      urls: routed.flatMap((item) => (item.recipient?.windowID === recipient.windowID ? [item.link.url] : [])),
    }))

  if (batches.length === 0) return { state, commands: [] }

  const links = routed.map((item): DeepLink => {
    const batch = batches.find((candidate) => candidate.windowID === item.recipient?.windowID)

    if (!batch) return item.link

    return {
      status: "delivered",
      url: item.link.url,
      target: item.link.target,
      clientID: batch.clientID,
      attempt: batch.attempt,
    }
  })

  return {
    state: { ...state, links, nextAttempt: state.nextAttempt + batches.length },
    commands: batches.map((batch): DeepLinkCommand => ({ type: "links.deliver", ...batch })),
  }
}

// A renderer that went away without acknowledging may not have handled its links, so they wait for the next one.
function requeue(links: readonly DeepLink[], clientID: number) {
  return links.map(
    (link): DeepLink =>
      link.status === "delivered" && link.clientID === clientID
        ? { status: "queued", url: link.url, target: link.target }
        : link,
  )
}

function unchanged(state: DeepLinkState): DeepLinkTransition {
  return { state, commands: [] }
}
