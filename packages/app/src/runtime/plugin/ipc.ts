import { untrack } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Exit, Schema } from "effect"
import type { Ipc, IpcCallOptions, IpcClient, IpcSpec } from "@opencode/plugin/gui"
import type { Bridge } from "@opencode/plugin/gui/host"
import {
  createIpcState,
  selectIpcAvailable,
  selectIpcFailed,
  selectIpcGeneration,
  selectIpcNeedsSubscribe,
  selectIpcValue,
  transitionIpc,
  type IpcEffect,
  type IpcEvent,
} from "./ipc-machine"

type Codec = NonNullable<IpcSpec["state"]>

/** A value an Ipc's codec decodes to; each Ipc's `IpcClient` gives it that Ipc's own type. */
type Decoded = Codec["Type"]

/** A value as it crosses the bridge, encoded by an Ipc's codec. */
type Encoded = Codec["Encoded"]

type View = { available: boolean; generation: number; failed: boolean; value: Decoded }

// How long main may take to answer a subscribe before the Ipc counts as failed.
const subscribeTimeout = 10_000

/** Renderer-side clients for the Ipcs that plugins provide in the main process. */
export function createIpcClients(bridge: Bridge | undefined) {
  const machine = { state: createIpcState() }
  // What readers see of each Ipc, projected from the machine and reconciled, so a change wakes only its own readers.
  const [views, setViews] = createStore<Record<string, View | undefined>>({})
  // Events an effect raises synchronously wait behind that effect.
  const queue: IpcEvent[] = []
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const specs = new Map<string, IpcSpec>()
  const clients = new Map<string, IpcClient<IpcSpec>>()
  const listeners = new Map<string, Set<(name: string, data: Decoded) => void>>()

  const dispatch = (event: IpcEvent) => {
    queue.push(event)

    if (queue.length === 1) untrack(drain)
  }

  const drain = () => {
    const event = queue[0]

    if (!event) return

    const next = transitionIpc(machine.state, event)

    if (next.state !== machine.state && event.type !== "disposed")
      setViews(
        event.id,
        reconcile({
          available: selectIpcAvailable(next.state, event.id),
          generation: selectIpcGeneration(next.state, event.id),
          failed: selectIpcFailed(next.state, event.id),
          value: selectIpcValue(next.state, event.id),
        }),
      )

    machine.state = next.state
    next.effects.forEach(run)
    queue.shift()
    drain()
  }

  const run = (effect: IpcEffect) => {
    if (effect.type === "subscribe") {
      if (!bridge) return

      return void Promise.try(() => bridge.subscribe(effect.id)).then(
        (result) => {
          const state = result.state === undefined ? Exit.succeed(undefined) : decodeState(effect.id, result.state)

          if (Exit.isFailure(state))
            return dispatch({ type: "failed", id: effect.id, attempt: effect.attempt, cause: state.cause })

          dispatch({
            type: "subscribed",
            id: effect.id,
            attempt: effect.attempt,
            available: result.available,
            state: state.value,
          })
        },
        (cause: unknown) => dispatch({ type: "failed", id: effect.id, attempt: effect.attempt, cause }),
      )
    }

    if (effect.type === "timer.start") {
      clearTimeout(timers.get(effect.id))
      timers.set(
        effect.id,
        setTimeout(() => dispatch({ type: "timeout", id: effect.id, attempt: effect.attempt }), subscribeTimeout),
      )

      return
    }

    if (effect.type === "timer.stop") {
      clearTimeout(timers.get(effect.id))
      timers.delete(effect.id)

      return
    }

    console.error(`[plugin] ${effect.id}`, effect.cause)
  }

  const decodeState = (id: string, value: Encoded) => {
    const schema = specs.get(id)?.state

    return schema ? Schema.decodeUnknownExit(schema)(value) : Exit.succeed(value)
  }

  // A payload its codec rejects is dropped here, so it never throws into the bridge's other listeners.
  const stop = bridge?.on((message) => {
    if (message.type === "available")
      return dispatch({ type: "available", id: message.ipc, available: message.available })

    if (message.type === "state") {
      if (!specs.has(message.ipc)) return

      const state = decodeState(message.ipc, message.state)

      if (Exit.isFailure(state)) return console.error(`[plugin] ${message.ipc}`, state.cause)

      return dispatch({ type: "state", id: message.ipc, value: state.value })
    }

    if (message.type !== "event") return

    const schema = specs.get(message.ipc)?.events?.[message.name]
    const data = schema ? Schema.decodeUnknownExit(schema)(message.data) : Exit.succeed(message.data)

    if (Exit.isFailure(data)) return console.error(`[plugin] ${message.ipc}`, data.cause)

    listeners.get(message.ipc)?.forEach((listener) => listener(message.name, data.value))
  })

  const create = (connected: Bridge, token: Ipc): IpcClient<IpcSpec> => {
    const methods = Object.fromEntries(
      Object.entries(token.spec.methods).map(([name, method]) => {
        const call = async (input: Decoded, options?: IpcCallOptions) => {
          const encoded = method.input ? Schema.encodeUnknownSync(method.input)(input) : null
          const output = await connected.call({ ipc: token.id, method: name, input: encoded }, options?.signal)

          return method.output ? Schema.decodeUnknownSync(method.output)(output) : undefined
        }

        return [name, method.input ? call : (options?: IpcCallOptions) => call(undefined, options)]
      }),
    )

    const client = Object.assign(methods, {
      state: () => (views[token.id]?.available ? views[token.id]?.value : undefined),
      on(name: string, listener: (data: Decoded) => void) {
        const set = listeners.get(token.id) ?? new Set()

        const wrapped = (event: string, data: Decoded) => {
          if (event === name) listener(data)
        }

        set.add(wrapped)
        listeners.set(token.id, set)

        return () => {
          set.delete(wrapped)
        }
      },
    })

    // SAFETY: `methods` holds one codec-checked function per method of the token's spec, beside `state` and `on`.
    return client as IpcClient<IpcSpec>
  }

  const client = (token: Ipc) => {
    if (!bridge) return undefined

    specs.set(token.id, token.spec)

    if (selectIpcNeedsSubscribe(machine.state, token.id)) dispatch({ type: "subscribe", id: token.id })

    if (!views[token.id]?.available) return undefined

    const existing = clients.get(token.id)

    if (existing) return existing

    const created = create(bridge, token)

    clients.set(token.id, created)

    return created
  }

  return {
    client,
    /** How many times the Ipc became available; 0 until it first is. Reactive. */
    generation: (token: Ipc) => views[token.id]?.generation ?? 0,
    /** Main did not answer the Ipc's subscribe; the next time main provides it, the window asks again. Reactive. */
    failed: (token: Ipc) => views[token.id]?.failed ?? false,
    /** A client typed by its token, for host code that uses one Ipc directly. */
    typed: <S extends IpcSpec>(token: Ipc<S>) =>
      // SAFETY: the client was built from this token's spec, so its methods, state and events are those of `S`.
      client(token) as IpcClient<S> | undefined,
    /** Stops listening to the bridge. Call it when the owner of these clients goes away. */
    dispose() {
      stop?.()
      dispatch({ type: "disposed" })
    },
  }
}
