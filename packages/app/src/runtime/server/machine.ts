import type { ServerConnection } from "./registry"

/** What a server's controller is bound to, as plain values read from its listed connection. */
export type ServerCredentials = {
  /**
   * An HTTP controller keeps the endpoint it started with, so new credentials need a new controller. Other servers
   * move their transport to a new endpoint in place and keep one controller (`""`).
   */
  readonly controller: string
  /** The endpoint health checks probe, or undefined while a plugin server is not ready. */
  readonly auth: string | undefined
}

/** One server's controller. `starting` lasts only until the driver reports the controller it created. */
export type ServerControllerState<T> =
  | { readonly type: "absent"; readonly attempt: number }
  | {
      readonly type: "starting"
      readonly attempt: number
      readonly conn: ServerConnection.Any
      readonly credentials: ServerCredentials
    }
  | {
      readonly type: "live"
      readonly attempt: number
      readonly conn: ServerConnection.Any
      readonly credentials: ServerCredentials
      readonly ctx: T
      readonly dispose: () => void
    }
  | {
      readonly type: "unauthorized"
      readonly attempt: number
      readonly conn: ServerConnection.Any
      readonly credentials: ServerCredentials
      /** The `auth` the server answered with HTTP 401. */
      readonly rejected: string
    }

export type ServerControllersState<T> = ReadonlyMap<ServerConnection.Key, ServerControllerState<T>>

export type ServerControllersEvent<T> =
  | {
      readonly type: "servers.synced"
      readonly entries: readonly {
        readonly key: ServerConnection.Key
        readonly conn: ServerConnection.Any
        readonly credentials: ServerCredentials
      }[]
    }
  | {
      readonly type: "controller.created"
      readonly key: ServerConnection.Key
      readonly attempt: number
      readonly ctx: T
      readonly dispose: () => void
    }
  | {
      readonly type: "health.reported"
      readonly key: ServerConnection.Key
      readonly auth: string
      readonly healthy: boolean
      readonly unauthorized: boolean
    }
  | { readonly type: "disposed" }

export type ServerControllersEffect =
  | {
      readonly type: "create"
      readonly key: ServerConnection.Key
      readonly attempt: number
      readonly conn: ServerConnection.Any
    }
  | { readonly type: "dispose"; readonly dispose: () => void }

export type ServerControllersTransition<T> = {
  readonly state: ServerControllersState<T>
  readonly effects: readonly ServerControllersEffect[]
}

type ServerEvent<T> =
  | { readonly type: "server.listed"; readonly conn: ServerConnection.Any; readonly credentials: ServerCredentials }
  | { readonly type: "server.unlisted" }
  | Extract<ServerControllersEvent<T>, { type: "controller.created" | "health.reported" }>

type ServerEffect =
  | { readonly type: "create"; readonly attempt: number; readonly conn: ServerConnection.Any }
  | { readonly type: "dispose"; readonly dispose: () => void }

type ServerTransition<T> = { readonly state: ServerControllerState<T>; readonly effects: readonly ServerEffect[] }

export function endpointCredentials(http: ServerConnection.HttpBase) {
  return `${http.url}\n${http.password ?? ""}`
}

export function serverCredentials(conn: ServerConnection.Any): ServerCredentials {
  const endpoint = endpointCredentials(conn.http)

  return {
    controller: conn.type === "http" ? endpoint : "",
    auth: conn.type === "plugin" && conn.state !== "ready" ? undefined : endpoint,
  }
}

export function createServerControllersState<T>(): ServerControllersState<T> {
  return new Map()
}

export function transitionServerControllers<T>(
  state: ServerControllersState<T>,
  event: ServerControllersEvent<T>,
): ServerControllersTransition<T> {
  if (event.type === "servers.synced") {
    const listed = new Set(event.entries.map((entry) => entry.key))

    return apply(state, [
      ...[...state.keys()].flatMap((key) => (listed.has(key) ? [] : [{ key, event: unlisted }])),
      ...event.entries.map((entry) => ({
        key: entry.key,
        event: { type: "server.listed" as const, conn: entry.conn, credentials: entry.credentials },
      })),
    ])
  }

  if (event.type === "disposed") return apply(state, [...state.keys()].map((key) => ({ key, event: unlisted })))

  return apply(state, [{ key: event.key, event }])
}

/** The live controller of a server; undefined while it is unlisted or rejects our credentials. */
export function selectServerCtx<T>(state: ServerControllersState<T>, key: ServerConnection.Key) {
  const slot = state.get(key)

  return slot?.type === "live" ? slot.ctx : undefined
}

/** The server answered our current credentials with HTTP 401, so it has no controller until it signs in again. */
export function selectServerSignedOut<T>(state: ServerControllersState<T>, key: ServerConnection.Key) {
  return state.get(key)?.type === "unauthorized"
}

const unlisted = { type: "server.unlisted" } as const

function apply<T>(
  state: ServerControllersState<T>,
  steps: readonly { key: ServerConnection.Key; event: ServerEvent<T> }[],
): ServerControllersTransition<T> {
  return steps.reduce<ServerControllersTransition<T>>(
    (result, step) => {
      const current = result.state.get(step.key) ?? { type: "absent", attempt: 0 }
      const next = transitionServer(current, step.event)

      return {
        state: next.state === current ? result.state : new Map(result.state).set(step.key, next.state),
        effects: [
          ...result.effects,
          ...next.effects.map((effect) => (effect.type === "create" ? { ...effect, key: step.key } : effect)),
        ],
      }
    },
    { state, effects: [] },
  )
}

function transitionServer<T>(state: ServerControllerState<T>, event: ServerEvent<T>): ServerTransition<T> {
  if (event.type === "controller.created") {
    if (state.type === "starting" && state.attempt === event.attempt) {
      return {
        state: {
          type: "live",
          attempt: state.attempt,
          conn: state.conn,
          credentials: state.credentials,
          ctx: event.ctx,
          dispose: event.dispose,
        },
        effects: [],
      }
    }

    // A creation that a newer listing, a rejection or an unlisting superseded never becomes visible.
    return { state, effects: [{ type: "dispose", dispose: event.dispose }] }
  }

  if (event.type === "server.unlisted") {
    if (state.type === "absent") return { state, effects: [] }

    return { state: { type: "absent", attempt: state.attempt }, effects: release(state) }
  }

  if (event.type === "server.listed") return listed(state, event.conn, event.credentials)

  return reported(state, event)
}

function listed<T>(
  state: ServerControllerState<T>,
  conn: ServerConnection.Any,
  credentials: ServerCredentials,
): ServerTransition<T> {
  if (state.type === "absent") return start(state, conn, credentials, [])

  if (state.type === "unauthorized") {
    // The rejected credentials would fail again, and a plugin server that is not ready has none to try yet.
    if (credentials.auth === undefined || credentials.auth === state.rejected) return update(state, conn, credentials)

    return start(state, conn, credentials, [])
  }

  if (credentials.controller !== state.credentials.controller) return start(state, conn, credentials, release(state))

  return update(state, conn, credentials)
}

function reported<T>(
  state: ServerControllerState<T>,
  event: Extract<ServerEvent<T>, { type: "health.reported" }>,
): ServerTransition<T> {
  if (state.type === "absent") return { state, effects: [] }

  // A server that accepts the rejected credentials again, such as after its password was restored, gets a controller.
  if (state.type === "unauthorized") {
    if (event.healthy && event.auth === state.credentials.auth) return start(state, state.conn, state.credentials, [])

    return { state, effects: [] }
  }

  // A probe of credentials the server has since replaced says nothing about the current ones.
  if (!event.unauthorized || event.auth !== state.credentials.auth) return { state, effects: [] }

  return {
    state: {
      type: "unauthorized",
      attempt: state.attempt,
      conn: state.conn,
      credentials: state.credentials,
      rejected: event.auth,
    },
    effects: release(state),
  }
}

function start<T>(
  state: ServerControllerState<T>,
  conn: ServerConnection.Any,
  credentials: ServerCredentials,
  effects: readonly ServerEffect[],
): ServerTransition<T> {
  const attempt = state.attempt + 1

  return {
    state: { type: "starting", attempt, conn, credentials },
    effects: [...effects, { type: "create", attempt, conn }],
  }
}

function update<T>(
  state: Exclude<ServerControllerState<T>, { type: "absent" }>,
  conn: ServerConnection.Any,
  credentials: ServerCredentials,
): ServerTransition<T> {
  if (
    state.conn === conn &&
    state.credentials.controller === credentials.controller &&
    state.credentials.auth === credentials.auth
  )
    return { state, effects: [] }

  return { state: { ...state, conn, credentials }, effects: [] }
}

function release<T>(state: ServerControllerState<T>): ServerEffect[] {
  return state.type === "live" ? [{ type: "dispose", dispose: state.dispose }] : []
}
