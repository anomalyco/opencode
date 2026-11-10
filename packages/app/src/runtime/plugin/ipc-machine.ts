export type IpcChannel =
  /** Only main's availability broadcasts arrived; no window code asked for a client yet. */
  | { readonly status: "unsubscribed"; readonly available: boolean; readonly generation: number }
  /**
   * `subscribe` is in flight. `available` is the last availability known; `moved` is true once a broadcast arrived
   * during the flight, which is newer than the reply. `pushed` is state main pushed during the flight.
   */
  | {
      readonly status: "subscribing"
      readonly attempt: number
      readonly generation: number
      readonly available: boolean
      readonly moved: boolean
      readonly pushed: { readonly value: unknown } | undefined
    }
  | { readonly status: "available"; readonly generation: number; readonly value: unknown }
  | { readonly status: "unavailable"; readonly generation: number }
  /** The subscribe request failed or timed out; the next availability broadcast subscribes again. */
  | { readonly status: "failed"; readonly generation: number }

export type IpcState = {
  readonly status: "running" | "disposed"
  readonly issued: number
  readonly channels: Readonly<Record<string, IpcChannel>>
}

export type IpcEvent =
  /** Window code asked for the Ipc's client. */
  | { readonly type: "subscribe"; readonly id: string }
  | {
      readonly type: "subscribed"
      readonly id: string
      readonly attempt: number
      readonly available: boolean
      /** The decoded state main sent with the reply, if any. */
      readonly state: unknown
    }
  | { readonly type: "failed"; readonly id: string; readonly attempt: number; readonly cause: unknown }
  | { readonly type: "timeout"; readonly id: string; readonly attempt: number }
  | { readonly type: "available"; readonly id: string; readonly available: boolean }
  /** Decoded state main pushed. */
  | { readonly type: "state"; readonly id: string; readonly value: unknown }
  | { readonly type: "disposed" }

export type IpcEffect =
  | { readonly type: "subscribe"; readonly id: string; readonly attempt: number }
  | { readonly type: "timer.start"; readonly id: string; readonly attempt: number }
  | { readonly type: "timer.stop"; readonly id: string }
  | { readonly type: "log"; readonly id: string; readonly cause: unknown }

export type IpcTransition = { readonly state: IpcState; readonly effects: readonly IpcEffect[] }

export function createIpcState(): IpcState {
  return { status: "running", issued: 0, channels: {} }
}

export function transitionIpc(state: IpcState, event: IpcEvent): IpcTransition {
  if (state.status === "disposed") return step(state)

  if (event.type === "disposed")
    return step(
      { status: "disposed", issued: state.issued, channels: {} },
      Object.entries(state.channels).flatMap(([id, channel]) =>
        channel.status === "subscribing" ? [{ type: "timer.stop", id } as const] : [],
      ),
    )

  const channel = state.channels[event.id]

  if (event.type === "subscribe") {
    if (channel && channel.status !== "unsubscribed") return step(state)

    return subscribe(state, event.id, {
      generation: channel?.generation ?? 0,
      available: channel?.available ?? false,
      moved: false,
    })
  }

  if (event.type === "available") return available(state, event.id, channel, event.available)

  if (event.type === "state") {
    if (channel?.status === "subscribing")
      return step(put(state, event.id, { ...channel, pushed: { value: event.value } }))

    if (channel?.status === "available") return step(put(state, event.id, { ...channel, value: event.value }))

    // Main pushes state only while it provides the Ipc.
    return step(state)
  }

  if (channel?.status !== "subscribing" || channel.attempt !== event.attempt) return step(state)

  if (event.type === "subscribed") {
    // A broadcast during the flight is newer than the reply's availability, and a push newer than its state.
    const live = channel.moved ? channel.available : event.available
    const generation = live && !channel.available ? channel.generation + 1 : channel.generation
    const stop = [{ type: "timer.stop", id: event.id } as const]

    if (!live) return step(put(state, event.id, { status: "unavailable", generation }), stop)

    return step(
      put(state, event.id, {
        status: "available",
        generation,
        value: channel.pushed ? channel.pushed.value : event.state,
      }),
      stop,
    )
  }

  const cause = event.type === "failed" ? event.cause : new Error(`Ipc "${event.id}" did not answer the subscribe`)

  return step(put(state, event.id, { status: "failed", generation: channel.generation }), [
    { type: "timer.stop", id: event.id },
    { type: "log", id: event.id, cause },
  ])
}

/** Window code reading the client asks main for it: never yet asked, and the clients still run. */
export function selectIpcNeedsSubscribe(state: IpcState, id: string) {
  const channel = state.channels[id]

  return state.status === "running" && (!channel || channel.status === "unsubscribed")
}

/** Main provides the Ipc, as far as the window knows. */
export function selectIpcAvailable(state: IpcState, id: string) {
  const channel = state.channels[id]

  return channel?.status === "available" || (channel?.status === "subscribing" && channel.available)
}

export function selectIpcValue(state: IpcState, id: string) {
  const channel = state.channels[id]

  if (channel?.status === "available") return channel.value

  if (channel?.status === "subscribing" && channel.available) return channel.pushed?.value

  return undefined
}

/** How many times the Ipc became available; 0 until it first is. */
export function selectIpcGeneration(state: IpcState, id: string) {
  return state.channels[id]?.generation ?? 0
}

export function selectIpcFailed(state: IpcState, id: string) {
  return state.channels[id]?.status === "failed"
}

function available(state: IpcState, id: string, channel: IpcChannel | undefined, next: boolean): IpcTransition {
  if (!channel) return step(put(state, id, { status: "unsubscribed", available: next, generation: next ? 1 : 0 }))

  const generation = next ? channel.generation + 1 : channel.generation

  if (channel.status === "unsubscribed") {
    if (channel.available === next) return step(state)

    return step(put(state, id, { status: "unsubscribed", available: next, generation }))
  }

  if (channel.status === "subscribing")
    return step(
      put(state, id, {
        ...channel,
        available: next,
        moved: true,
        generation: next && !channel.available ? generation : channel.generation,
        // Going away clears the state too, so the reply's older state never shows.
        pushed: next ? channel.pushed : { value: undefined },
      }),
    )

  if (channel.status === "available") {
    if (next) return step(state)

    return step(put(state, id, { status: "unavailable", generation: channel.generation }))
  }

  if (channel.status === "unavailable") {
    if (!next) return step(state)

    return step(put(state, id, { status: "available", generation, value: undefined }))
  }

  // A provider that comes back may answer a subscribe that failed before.
  if (!next) return step(state)

  return subscribe(state, id, { generation, available: true, moved: true })
}

function subscribe(
  state: IpcState,
  id: string,
  input: { readonly generation: number; readonly available: boolean; readonly moved: boolean },
) {
  const attempt = state.issued + 1

  return step(put({ ...state, issued: attempt }, id, { status: "subscribing", attempt, pushed: undefined, ...input }), [
    { type: "subscribe", id, attempt },
    { type: "timer.start", id, attempt },
  ])
}

function put(state: IpcState, id: string, channel: IpcChannel): IpcState {
  return { ...state, channels: { ...state.channels, [id]: channel } }
}

function step(state: IpcState, effects: readonly IpcEffect[] = []): IpcTransition {
  return { state, effects }
}
