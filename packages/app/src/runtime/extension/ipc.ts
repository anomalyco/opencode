import { batch } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Schema } from "effect"
import type { Ipc, IpcCallOptions, IpcClient, IpcSpec } from "@opencode/gui-extensions/sdk"
import type { Bridge } from "@opencode/gui-extensions/sdk/bridge"

type Codec = NonNullable<IpcSpec["state"]>

/** A value an Ipc's codec decodes to; each Ipc's `IpcClient` gives it that Ipc's own type. */
type Decoded = Codec["Type"]

/** A value as it crosses the bridge, encoded by an Ipc's codec. */
type Encoded = Codec["Encoded"]

type IpcState = {
  available: Record<string, boolean | undefined>
  values: Record<string, Decoded>
  // Counts each time an Ipc becomes available, so users can tell a returning provider from the one they had.
  generations: Record<string, number | undefined>
}

/** Renderer-side clients for the Ipcs that extensions provide in the main process. */
export function createIpcClients(bridge: Bridge | undefined) {
  const [state, setState] = createStore<IpcState>({ available: {}, values: {}, generations: {} })

  const setAvailable = (id: string, available: boolean) => {
    if (available && !state.available[id]) setState("generations", id, (value = 0) => value + 1)

    setState("available", id, available)
  }

  const specs = new Map<string, IpcSpec>()
  const clients = new Map<string, IpcClient<IpcSpec>>()
  const listeners = new Map<string, Set<(name: string, data: Decoded) => void>>()
  const subscribed = new Set<string>()
  // How many availability and state events reached each Ipc. Events are newer than any snapshot, so a
  // subscribe reply only fills in what no event changed while it was in flight.
  const changes = new Map<string, { available: number; state: number }>()

  const changesOf = (id: string) => {
    const existing = changes.get(id)

    if (existing) return existing

    const created = { available: 0, state: 0 }

    changes.set(id, created)

    return created
  }

  const decodeState = (id: string, value: Encoded): Decoded => {
    const schema = specs.get(id)?.state

    return schema ? Schema.decodeUnknownSync(schema)(value) : value
  }

  const stop = bridge?.on((message) => {
    if (message.type === "state") {
      if (!specs.has(message.ipc)) return

      changesOf(message.ipc).state++
      setState("values", message.ipc, reconcile(decodeState(message.ipc, message.state)))

      return
    }

    if (message.type === "available") {
      const changed = changesOf(message.ipc)

      changed.available++

      // Going away clears the state too.
      if (!message.available) changed.state++

      batch(() => {
        setAvailable(message.ipc, message.available)

        if (!message.available) setState("values", message.ipc, undefined)
      })

      return
    }

    if (message.type !== "event") return

    const schema = specs.get(message.ipc)?.events?.[message.name]
    const data = schema ? Schema.decodeUnknownSync(schema)(message.data) : message.data

    listeners.get(message.ipc)?.forEach((listener) => listener(message.name, data))
  })

  const subscribe = (connected: Bridge, token: Ipc) => {
    if (subscribed.has(token.id)) return

    subscribed.add(token.id)
    specs.set(token.id, token.spec)

    const before = { ...changesOf(token.id) }

    void connected.subscribe(token.id).then((result) => {
      const after = changesOf(token.id)

      batch(() => {
        if (after.available === before.available) setAvailable(token.id, result.available)

        if (after.state === before.state && result.state !== undefined)
          setState("values", token.id, decodeState(token.id, result.state))
      })
    })
  }

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
      state: () => state.values[token.id],
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

    subscribe(bridge, token)

    if (!state.available[token.id]) return undefined

    const existing = clients.get(token.id)

    if (existing) return existing

    const created = create(bridge, token)

    clients.set(token.id, created)

    return created
  }

  return {
    client,
    /** How many times the Ipc became available; 0 until it first is. Reactive. */
    generation: (token: Ipc) => state.generations[token.id] ?? 0,
    /** A client typed by its token, for host code that uses one Ipc directly. */
    typed: <S extends IpcSpec>(token: Ipc<S>) =>
      // SAFETY: the client was built from this token's spec, so its methods, state and events are those of `S`.
      client(token) as IpcClient<S> | undefined,
    /** Stops listening to the bridge. Call it when the owner of these clients goes away. */
    dispose() {
      stop?.()
    },
  }
}
