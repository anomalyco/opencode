import type { SshConfig, SshError, SshHttp, SshItem, SshPrompt, SshStart } from "./contract"

/** Failures in a row after which main stops reconnecting a saved server by itself. */
export const SSH_RETRY_LIMIT = 5

export const SSH_RETRY_DELAY_MS = 3_000

/** Where a saved server returns when the window that started an attempt cancels it. */
export type SshResting =
  | { readonly status: "disconnected" }
  | { readonly status: "authentication" }
  | { readonly status: "incompatible"; readonly detail: string }
  | { readonly status: "failed"; readonly code: SshError; readonly detail: string; readonly failures: number }

/**
 * One server's connection. `attempt` fences every result of a connect: a result for any other attempt is stale.
 * `owner` is the window that started an interactive attempt; only it sees and answers the prompt. A background
 * attempt has none and pauses in `authentication` at its first prompt. A `failed` server with `retry` reconnects by
 * itself once the retry is due; without it, it waits for the user.
 */
export type SshServerPhase =
  | { readonly status: "disconnected" }
  | { readonly status: "authentication" }
  | { readonly status: "incompatible"; readonly detail: string }
  | {
      readonly status: "connecting"
      readonly attempt: number
      readonly owner?: number
      readonly failures: number
      readonly resting: SshResting
    }
  | {
      readonly status: "authenticating"
      readonly attempt: number
      readonly owner: number
      readonly failures: number
      readonly resting: SshResting
      readonly prompt: SshPrompt
    }
  | { readonly status: "ready"; readonly attempt: number; readonly http: SshHttp }
  | {
      readonly status: "failed"
      readonly code: SshError
      readonly detail: string
      readonly failures: number
      readonly retry?: { readonly attempt: number }
    }

export type SshServerRecord = {
  readonly config: SshConfig
  /** The config last saved; a saved server keeps it while an attempt tries another target or name. */
  readonly savedConfig?: SshConfig
  readonly destination?: string
  readonly phase: SshServerPhase
  /** `resolve` calls waiting for the server to be ready, or to stop reconnecting by itself. */
  readonly waiters: readonly number[]
}

/** Open until the plugin stops for good; a closed machine starts nothing. */
export type SshMainState = {
  readonly status: "open" | "closed"
  readonly issued: number
  readonly servers: readonly SshServerRecord[]
}

export type SshMainEvent =
  | { readonly type: "start"; readonly request: SshStart; readonly owner?: number }
  | {
      readonly type: "destination.resolved"
      readonly id: string
      readonly attempt: number
      readonly destination: string
    }
  | { readonly type: "prompt.received"; readonly id: string; readonly attempt: number; readonly prompt: SshPrompt }
  | { readonly type: "prompt.cleared"; readonly id: string; readonly attempt: number; readonly promptID: string }
  | {
      readonly type: "respond"
      readonly id: string
      readonly promptID: string
      readonly value: string
      readonly owner: number
    }
  | { readonly type: "attempt.ready"; readonly id: string; readonly attempt: number; readonly http: SshHttp }
  /** A connect failed, or the tunnel of a ready server closed. */
  | {
      readonly type: "attempt.failed"
      readonly id: string
      readonly attempt: number
      readonly code: SshError
      readonly detail: string
    }
  | { readonly type: "retry.due"; readonly id: string; readonly attempt: number }
  | { readonly type: "resolve.requested"; readonly id: string; readonly waiter: number }
  | { readonly type: "resolve.aborted"; readonly id: string; readonly waiter: number }
  | {
      readonly type: "health.probed"
      readonly id: string
      readonly attempt: number
      readonly waiter: number
      readonly healthy: boolean
    }
  | { readonly type: "cancel"; readonly id: string; readonly owner: number }
  | { readonly type: "forget"; readonly id: string }
  | { readonly type: "window.detached"; readonly owner: number }
  | { readonly type: "close" }

export type SshMainEffect =
  | {
      readonly type: "attempt.start"
      readonly id: string
      readonly attempt: number
      readonly config: SshConfig
      readonly replace: boolean
    }
  | { readonly type: "attempt.stop"; readonly attempt: number }
  | { readonly type: "attempt.respond"; readonly attempt: number; readonly promptID: string; readonly value: string }
  | { readonly type: "retry.schedule"; readonly id: string; readonly attempt: number; readonly delayMs: number }
  | { readonly type: "retry.cancel"; readonly attempt: number }
  | {
      readonly type: "health.probe"
      readonly id: string
      readonly attempt: number
      readonly http: SshHttp
      readonly waiter: number
    }
  | { readonly type: "waiters.resolve"; readonly waiters: readonly number[]; readonly http: SshHttp | null }
  | { readonly type: "configs.save"; readonly configs: readonly SshConfig[] }

export type SshMainTransition = {
  readonly state: SshMainState
  readonly effects: readonly SshMainEffect[]
}

type Active = Extract<SshServerPhase, { status: "connecting" | "authenticating" }>

const DISCONNECTED: SshServerPhase = { status: "disconnected" }

export function createSshMainState(configs: readonly SshConfig[]): SshMainState {
  return {
    status: "open",
    issued: 0,
    servers: configs.map((config) => ({ config, savedConfig: config, phase: DISCONNECTED, waiters: [] })),
  }
}

export function transitionSshMain(state: SshMainState, event: SshMainEvent): SshMainTransition {
  if (state.status === "closed") {
    if (event.type === "resolve.requested") return { state, effects: [resolved([event.waiter], null)] }

    return unchanged(state)
  }

  if (event.type === "start") return start(state, event.request, event.owner)

  if (event.type === "close") return close(state)

  if (event.type === "window.detached")
    return state.servers.reduce<SshMainTransition>((result, server) => {
      const next = cancel(result.state, server.config.id, event.owner)

      return { state: next.state, effects: [...result.effects, ...next.effects] }
    }, unchanged(state))

  if (event.type === "cancel") return cancel(state, event.id, event.owner)

  const server = state.servers.find((item) => item.config.id === event.id)

  if (!server) {
    if (event.type === "resolve.requested") return { state, effects: [resolved([event.waiter], null)] }

    return unchanged(state)
  }

  const phase = server.phase

  if (event.type === "forget")
    return {
      state: { ...state, servers: state.servers.filter((item) => item !== server) },
      effects: [
        ...halt(phase),
        ...release(server.waiters),
        ...(server.savedConfig ? [save(state.servers.filter((item) => item !== server))] : []),
      ],
    }

  if (event.type === "resolve.requested") {
    if (phase.status === "ready")
      return {
        state: put(state, { ...server, waiters: [...server.waiters, event.waiter] }),
        effects: [
          { type: "health.probe", id: event.id, attempt: phase.attempt, http: phase.http, waiter: event.waiter },
        ],
      }

    if (isActive(phase) || (phase.status === "failed" && phase.retry))
      return { state: put(state, { ...server, waiters: [...server.waiters, event.waiter] }), effects: [] }

    return { state, effects: [resolved([event.waiter], null)] }
  }

  if (event.type === "resolve.aborted") {
    if (!server.waiters.includes(event.waiter)) return unchanged(state)

    return { state: put(state, { ...server, waiters: without(server.waiters, event.waiter) }), effects: [] }
  }

  if (event.type === "health.probed") {
    if (!server.waiters.includes(event.waiter) || phase.status !== "ready") return unchanged(state)

    // Another attempt already replaced the probed tunnel and is ready: its endpoint answers.
    if (event.healthy || phase.attempt !== event.attempt)
      return {
        state: put(state, { ...server, waiters: without(server.waiters, event.waiter) }),
        effects: [resolved([event.waiter], phase.http)],
      }

    const attempt = state.issued + 1

    return {
      state: put(
        { ...state, issued: attempt },
        {
          ...server,
          phase: { status: "connecting", attempt, failures: 0, resting: { status: "disconnected" } },
        },
      ),
      effects: [
        { type: "attempt.stop", attempt: phase.attempt },
        { type: "attempt.start", id: event.id, attempt, config: server.config, replace: false },
      ],
    }
  }

  if (event.type === "retry.due") {
    if (phase.status !== "failed" || phase.retry?.attempt !== event.attempt) return unchanged(state)
    const attempt = state.issued + 1

    return {
      state: put(
        { ...state, issued: attempt },
        {
          ...server,
          phase: {
            status: "connecting",
            attempt,
            failures: phase.failures,
            resting: { status: "failed", code: phase.code, detail: phase.detail, failures: phase.failures },
          },
        },
      ),
      effects: [{ type: "attempt.start", id: event.id, attempt, config: server.config, replace: false }],
    }
  }

  if (event.type === "respond") {
    if (phase.status !== "authenticating" || phase.owner !== event.owner || phase.prompt.id !== event.promptID)
      return unchanged(state)

    return {
      state,
      effects: [{ type: "attempt.respond", attempt: phase.attempt, promptID: event.promptID, value: event.value }],
    }
  }

  if (event.type === "attempt.failed") {
    if ((!isActive(phase) && phase.status !== "ready") || phase.attempt !== event.attempt) return unchanged(state)

    return failed(state, server, event.code, event.detail, (phase.status === "ready" ? 0 : phase.failures) + 1)
  }

  if (!isActive(phase) || phase.attempt !== event.attempt) return unchanged(state)

  if (event.type === "destination.resolved")
    return { state: put(state, { ...server, destination: event.destination }), effects: [] }

  if (event.type === "prompt.received") {
    // A background attempt has nobody to answer its prompt: the server waits for the user to sign in.
    if (phase.owner === undefined)
      return {
        state: put(state, { ...server, phase: { status: "authentication" }, waiters: [] }),
        effects: [{ type: "attempt.stop", attempt: phase.attempt }, ...release(server.waiters)],
      }

    return {
      state: put(state, {
        ...server,
        phase: { ...phase, status: "authenticating", owner: phase.owner, prompt: event.prompt },
      }),
      effects: [],
    }
  }

  if (event.type === "prompt.cleared") {
    if (phase.status !== "authenticating" || phase.prompt.id !== event.promptID) return unchanged(state)

    return {
      state: put(state, {
        ...server,
        phase: {
          status: "connecting",
          attempt: phase.attempt,
          owner: phase.owner,
          failures: phase.failures,
          resting: phase.resting,
        },
      }),
      effects: [],
    }
  }

  const ready = put(state, {
    ...server,
    savedConfig: server.config,
    phase: { status: "ready", attempt: phase.attempt, http: event.http },
    waiters: [],
  })

  return {
    state: ready,
    effects: [save(ready.servers), ...(server.waiters.length ? [resolved(server.waiters, event.http)] : [])],
  }
}

/** Every window's view of the servers; a prompt reaches only the window that started its attempt. */
export function selectSshServers(state: SshMainState, viewer?: number): SshItem[] {
  return state.servers.map((server) => {
    const phase = server.phase

    return {
      config: server.config,
      saved: !!server.savedConfig,
      destination: server.destination,
      stage: phase.status === "authenticating" ? "authentication" : phase.status,
      // Only a ready server has an endpoint.
      http: phase.status === "ready" ? phase.http : undefined,
      prompt: phase.status === "authenticating" && phase.owner === viewer ? phase.prompt : undefined,
      authenticatingElsewhere: phase.status === "authenticating" && phase.owner !== viewer,
      retrying: phase.status === "failed" && phase.retry ? true : undefined,
      detail: phase.status === "failed" || phase.status === "incompatible" ? phase.detail : "",
      error: error(phase),
    }
  })
}

function error(phase: SshServerPhase): SshError | undefined {
  if (phase.status === "failed") return phase.code

  if (phase.status === "incompatible") return "version"

  return undefined
}

/** An interactive attempt waits on its prompt; the remote service may take that long to answer. */
export function selectSshAuthenticating(state: SshMainState, id: string, attempt: number) {
  const phase = state.servers.find((server) => server.config.id === id)?.phase

  return phase?.status === "authenticating" && phase.attempt === attempt
}

function start(state: SshMainState, request: SshStart, owner: number | undefined): SshMainTransition {
  const id = request.id

  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) return unchanged(state)
  const server = state.servers.find((item) => item.config.id === id)
  const phase = server?.phase ?? DISCONNECTED

  // A second window must not replace an interactive attempt while its owner connects or answers a challenge.
  if (isActive(phase) && phase.owner !== undefined && phase.owner !== owner) return unchanged(state)

  // A background restore joins a server that is already connecting or ready.
  if (request.background && (isActive(phase) || phase.status === "ready")) return unchanged(state)
  const attempt = state.issued + 1
  const config = { id, target: request.target.trim(), name: request.name.trim() }

  return {
    state: put(
      { ...state, issued: attempt },
      {
        config,
        savedConfig: server?.savedConfig,
        destination: server?.destination,
        phase: {
          status: "connecting",
          attempt,
          owner: request.background ? undefined : owner,
          // The user asking again starts a new retry budget; a background restore keeps the one it had.
          failures: request.background && phase.status === "failed" ? phase.failures : 0,
          resting: resting(phase),
        },
        waiters: server?.waiters ?? [],
      },
    ),
    effects: [...halt(phase), { type: "attempt.start", id, attempt, config, replace: !!request.replace }],
  }
}

function failed(
  state: SshMainState,
  server: SshServerRecord,
  reported: SshError,
  detail: string,
  failures: number,
): SshMainTransition {
  const code = /REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/.test(detail)
    ? "host-key"
    : /spawn .*ENOENT/.test(detail)
      ? "ssh-missing"
      : reported

  // A failed attempt shows the saved server again, not the target it tried.
  const config = server.savedConfig ?? server.config

  if (code === "version")
    return {
      state: put(state, { ...server, config, phase: { status: "incompatible", detail }, waiters: [] }),
      effects: release(server.waiters),
    }

  // Only a saved server reconnects by itself, and only from failures that another try can fix.
  const retry =
    !!server.savedConfig &&
    failures < SSH_RETRY_LIMIT &&
    !["input", "platform", "unpublished", "host-key", "ssh-missing"].includes(code) &&
    !/Permission denied/.test(detail)

  if (!retry)
    return {
      state: put(state, { ...server, config, phase: { status: "failed", code, detail, failures }, waiters: [] }),
      effects: release(server.waiters),
    }

  const attempt = state.issued + 1

  return {
    state: put(
      { ...state, issued: attempt },
      { ...server, config, phase: { status: "failed", code, detail, failures, retry: { attempt } } },
    ),
    effects: [{ type: "retry.schedule", id: server.config.id, attempt, delayMs: SSH_RETRY_DELAY_MS }],
  }
}

function cancel(state: SshMainState, id: string, owner: number): SshMainTransition {
  const server = state.servers.find((item) => item.config.id === id)
  const phase = server?.phase

  if (!server || !phase || !isActive(phase) || phase.owner !== owner) return unchanged(state)
  const effects = [{ type: "attempt.stop", attempt: phase.attempt } as const, ...release(server.waiters)]

  // A server the window was adding is gone with its attempt.
  if (!server.savedConfig)
    return { state: { ...state, servers: state.servers.filter((item) => item !== server) }, effects }

  return {
    state: put(state, { ...server, config: server.savedConfig, phase: phase.resting, waiters: [] }),
    effects,
  }
}

function close(state: SshMainState): SshMainTransition {
  return {
    state: {
      ...state,
      status: "closed",
      servers: state.servers.map((server) => ({ ...server, phase: DISCONNECTED, waiters: [] })),
    },
    effects: [
      ...state.servers.flatMap((server) => halt(server.phase)),
      ...release(state.servers.flatMap((server) => server.waiters)),
    ],
  }
}

function resting(phase: SshServerPhase): SshResting {
  if (isActive(phase)) return phase.resting

  if (phase.status === "authentication") return phase

  if (phase.status === "incompatible") return { status: "incompatible", detail: phase.detail }

  if (phase.status === "failed")
    return { status: "failed", code: phase.code, detail: phase.detail, failures: phase.failures }

  return { status: "disconnected" }
}

/** Stops whatever runs for the server: its connect, its tunnel, or its scheduled retry. */
function halt(phase: SshServerPhase): SshMainEffect[] {
  if (isActive(phase) || phase.status === "ready") return [{ type: "attempt.stop", attempt: phase.attempt }]

  if (phase.status === "failed" && phase.retry) return [{ type: "retry.cancel", attempt: phase.retry.attempt }]

  return []
}

function isActive(phase: SshServerPhase): phase is Active {
  return phase.status === "connecting" || phase.status === "authenticating"
}

function put(state: SshMainState, server: SshServerRecord): SshMainState {
  const found = state.servers.some((item) => item.config.id === server.config.id)

  return {
    ...state,
    servers: found
      ? state.servers.map((item) => (item.config.id === server.config.id ? server : item))
      : [...state.servers, server],
  }
}

function save(servers: readonly SshServerRecord[]): SshMainEffect {
  return {
    type: "configs.save",
    configs: servers.flatMap((server) => (server.savedConfig ? [server.savedConfig] : [])),
  }
}

function release(waiters: readonly number[]): SshMainEffect[] {
  return waiters.length ? [resolved(waiters, null)] : []
}

function resolved(waiters: readonly number[], http: SshHttp | null): SshMainEffect {
  return { type: "waiters.resolve", waiters, http }
}

function without(waiters: readonly number[], waiter: number) {
  return waiters.filter((item) => item !== waiter)
}

function unchanged(state: SshMainState): SshMainTransition {
  return { state, effects: [] }
}
