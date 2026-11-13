import type { ServerConnection } from "@/runtime/server/registry"
import { toggleHomeProjectSelection } from "@/shell/layout/helpers"
import type { HomeProjectSelection } from "@/shell/state/layout"
import { pathKey } from "@/workspaces/path-key"

export type HomeProjectItem = {
  readonly id: string
  readonly worktree: string
}

export type HomeServerSnapshot = {
  readonly key: ServerConnection.Key
  readonly failed: boolean
  readonly connected: boolean
  /** The server's project list loaded, and the directories an older build listed for it are migrated. */
  readonly projectsReady: boolean
  readonly usedProjects: readonly HomeProjectItem[]
}

export type HomeEnvSnapshot = {
  /** The stored layout, the stored servers and the servers plugins contribute have all loaded. */
  readonly hydrated: boolean
  /** What `layout.home.selection` holds now. */
  readonly stored: HomeProjectSelection
  /** The servers Home lists, in order. */
  readonly servers: readonly HomeServerSnapshot[]
}

/** The worktree inventory demand of the selected project, once per connected server and project. */
export type HomeWorktreeSync =
  | { readonly status: "idle" }
  | {
      readonly status: "listing"
      readonly attempt: number
      readonly server: ServerConnection.Key
      readonly projectID: string
    }
  | { readonly status: "listed"; readonly server: ServerConnection.Key; readonly projectID: string }

type HomeSelectionBase = {
  readonly issued: number
  /** The selection storage holds, as last read or written. */
  readonly stored: HomeProjectSelection
  readonly servers: readonly HomeServerSnapshot[]
  /** A project add whose result selects the project, unless the user selects something else first. */
  readonly adding: { readonly attempt: number; readonly server: ServerConnection.Key } | undefined
  readonly worktrees: HomeWorktreeSync
}

/**
 * Home's server and project selection:
 * - `hydrating`: the layout or a server source has not loaded. Home shows the stored server when it is listed and the
 *   first server otherwise, and writes nothing. A selection the user makes meanwhile is `override`, which wins.
 * - `verifying`: the server is listed, and the directory waits for that server's projects before it is kept or cleared.
 * - `ready`: the server and its optional used project are checked against the loaded state.
 * - `disposed`: Home unmounted; late results are ignored.
 */
export type HomeSelectionState =
  | (HomeSelectionBase & { readonly status: "hydrating"; readonly override: HomeProjectSelection | undefined })
  | (HomeSelectionBase & {
      readonly status: "verifying"
      readonly server: ServerConnection.Key
      readonly directory: string
    })
  | (HomeSelectionBase & {
      readonly status: "ready"
      readonly server: ServerConnection.Key
      readonly project: HomeProjectItem | undefined
    })
  | { readonly status: "disposed" }

export type HomeSelectionEvent =
  | { readonly type: "env.synced"; readonly env: HomeEnvSnapshot }
  | { readonly type: "server.focused"; readonly server: ServerConnection.Key }
  | { readonly type: "project.toggled"; readonly server: ServerConnection.Key; readonly directory: string }
  | { readonly type: "project.add"; readonly server: ServerConnection.Key; readonly directories: readonly string[] }
  | { readonly type: "project.added"; readonly attempt: number; readonly project: HomeProjectItem | undefined }
  | { readonly type: "worktrees.listed"; readonly attempt: number }
  | { readonly type: "disposed" }

export type HomeSelectionEffect =
  | { readonly type: "selection.persist"; readonly selection: HomeProjectSelection }
  | {
      readonly type: "project.add"
      readonly attempt: number
      readonly server: ServerConnection.Key
      readonly directories: readonly string[]
    }
  | {
      readonly type: "worktrees.list"
      readonly attempt: number
      readonly server: ServerConnection.Key
      readonly projectID: string
    }
  | { readonly type: "worktrees.refresh"; readonly server: ServerConnection.Key; readonly projectID: string }

export type HomeSelectionTransition = {
  readonly state: HomeSelectionState
  readonly effects: readonly HomeSelectionEffect[]
}

type LiveState = Exclude<HomeSelectionState, { status: "disposed" }>

const IDLE: HomeWorktreeSync = Object.freeze({ status: "idle" })

const DISPOSED: HomeSelectionState = Object.freeze({ status: "disposed" })

const NONE: readonly HomeSelectionEffect[] = Object.freeze([])

export const INITIAL_HOME_SELECTION_STATE: HomeSelectionState = Object.freeze({
  status: "hydrating",
  issued: 0,
  stored: Object.freeze({}),
  servers: Object.freeze([]),
  adding: undefined,
  worktrees: IDLE,
  override: undefined,
})

export function transitionHomeSelection(state: HomeSelectionState, event: HomeSelectionEvent): HomeSelectionTransition {
  if (state.status === "disposed") return { state, effects: NONE }

  if (event.type === "disposed") return { state: DISPOSED, effects: NONE }

  if (event.type === "env.synced") return synced(state, event.env)

  if (event.type === "server.focused") return choose(state, { server: event.server })

  if (event.type === "project.toggled") {
    const entry = state.servers.find((server) => server.key === event.server)
    const project = entry && !entry.failed ? findProject(entry, event.directory) : undefined

    if (!entry || !project) return { state, effects: NONE }

    return choose(state, toggleHomeProjectSelection(selectHomeSelection(state), entry.key, project.worktree))
  }

  if (event.type === "project.add") {
    if (event.directories.length === 0) return { state, effects: NONE }
    const attempt = state.issued + 1

    return {
      state: { ...state, issued: attempt, adding: { attempt, server: event.server } },
      effects: [{ type: "project.add", attempt, server: event.server, directories: event.directories }],
    }
  }

  if (event.type === "project.added") {
    if (state.adding?.attempt !== event.attempt) return { state, effects: NONE }

    if (!event.project) return { state: { ...state, adding: undefined }, effects: NONE }

    return choose(state, { server: state.adding.server, directory: event.project.worktree })
  }

  const sync = state.worktrees

  if (sync.status !== "listing" || sync.attempt !== event.attempt) return { state, effects: NONE }

  return {
    state: { ...state, worktrees: { status: "listed", server: sync.server, projectID: sync.projectID } },
    effects: [{ type: "worktrees.refresh", server: sync.server, projectID: sync.projectID }],
  }
}

/** What Home shows as selected: always a listed server while there is one, and a used project's own path. */
export function selectHomeSelection(state: HomeSelectionState): HomeProjectSelection {
  if (state.status === "disposed") return {}

  if (state.status === "verifying") return { server: state.server, directory: state.directory }

  if (state.status === "ready")
    return state.project ? { server: state.server, directory: state.project.worktree } : { server: state.server }

  const target = state.override ?? state.stored
  const entry = state.servers.find((server) => server.key === target.server)

  if (!entry) return state.servers[0] ? { server: state.servers[0].key } : {}

  if (!target.directory) return { server: entry.key }

  return { server: entry.key, directory: findProject(entry, target.directory)?.worktree ?? target.directory }
}

export function sameHomeSelection(a: HomeProjectSelection | undefined, b: HomeProjectSelection | undefined) {
  return a?.server === b?.server && a?.directory === b?.directory
}

function synced(state: LiveState, env: HomeEnvSnapshot): HomeSelectionTransition {
  const servers = sameServers(state.servers, env.servers) ? state.servers : env.servers

  if (state.status === "hydrating") {
    const next = { ...state, servers, stored: selection(env.stored.server, env.stored.directory) }

    // Until everything loaded, the stored server may be missing only because its source has not reported yet.
    if (!env.hydrated) return finish(state, next, NONE)

    return place(state, next, state.override ?? next.stored)
  }

  // Another part of the app wrote the selection, such as a session's "Show in Home".
  const external = !sameHomeSelection(env.stored, state.stored)

  const next = {
    ...state,
    servers,
    stored: external ? selection(env.stored.server, env.stored.directory) : state.stored,
    adding: external ? undefined : state.adding,
  }

  return place(state, next, external ? next.stored : selectHomeSelection(state))
}

// A selection the user made: it wins over a project add still running.
function choose(state: LiveState, target: HomeProjectSelection): HomeSelectionTransition {
  if (state.status === "hydrating")
    return finish(state, { ...state, adding: undefined, override: selection(target.server, target.directory) }, NONE)

  return place(state, { ...state, adding: undefined }, target)
}

// Checks `target` against the listed servers and writes what storage does not hold yet.
function place(prev: LiveState, base: HomeSelectionBase, target: HomeProjectSelection): HomeSelectionTransition {
  const fields = {
    issued: base.issued,
    stored: base.stored,
    servers: base.servers,
    adding: base.adding,
    worktrees: base.worktrees,
  }

  const entry = base.servers.find((server) => server.key === target.server)
  const first = base.servers[0]

  // Home always lists a server; without one the selection stays as it is rather than being cleared.
  if (!first) return finish(prev, { ...prev, ...fields }, NONE)

  const next: LiveState = (() => {
    // The selected server is gone: its directory belonged to it, so only the first server is kept.
    if (!entry) return { ...fields, status: "ready", server: first.key, project: undefined }

    if (!target.directory) return { ...fields, status: "ready", server: entry.key, project: undefined }

    if (!entry.projectsReady) return { ...fields, status: "verifying", server: entry.key, directory: target.directory }

    return { ...fields, status: "ready", server: entry.key, project: findProject(entry, target.directory) }
  })()

  const persisted = selectHomeSelection(next)

  if (sameHomeSelection(persisted, base.stored)) return finish(prev, next, NONE)

  return finish(prev, { ...next, stored: persisted }, [{ type: "selection.persist", selection: persisted }])
}

// Starts the worktree demand when the selected used project changes or its server connects, and drops it otherwise.
function finish(prev: LiveState, next: LiveState, effects: readonly HomeSelectionEffect[]): HomeSelectionTransition {
  const target = worktreeTarget(next)
  const sync = next.worktrees

  const kept = target
    ? sync.status !== "idle" && sync.server === target.server && sync.projectID === target.projectID
    : sync.status === "idle"

  if (kept)
    return effects.length === 0 && sameState(prev, next) ? { state: prev, effects: NONE } : { state: next, effects }

  if (!target) return { state: { ...next, worktrees: IDLE }, effects }

  const attempt = next.issued + 1

  return {
    state: { ...next, issued: attempt, worktrees: { status: "listing", attempt, ...target } },
    effects: [...effects, { type: "worktrees.list", attempt, ...target }],
  }
}

function worktreeTarget(state: LiveState) {
  const current = selectHomeSelection(state)
  const entry = state.servers.find((server) => server.key === current.server)

  if (!entry?.connected || !current.directory) return
  const project = findProject(entry, current.directory)

  if (!project) return

  return { server: entry.key, projectID: project.id }
}

function sameState(a: LiveState, b: LiveState) {
  if (
    a.status !== b.status ||
    a.issued !== b.issued ||
    a.servers !== b.servers ||
    a.adding !== b.adding ||
    a.worktrees !== b.worktrees ||
    !sameHomeSelection(a.stored, b.stored)
  )
    return false

  if (a.status === "hydrating" && b.status === "hydrating")
    return a.override === b.override || (!!a.override && !!b.override && sameHomeSelection(a.override, b.override))

  if (a.status === "verifying" && b.status === "verifying") return a.server === b.server && a.directory === b.directory

  if (a.status === "ready" && b.status === "ready")
    return a.server === b.server && a.project?.id === b.project?.id && a.project?.worktree === b.project?.worktree

  return false
}

function sameServers(a: readonly HomeServerSnapshot[], b: readonly HomeServerSnapshot[]) {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index]!

      return (
        item.key === other.key &&
        item.failed === other.failed &&
        item.connected === other.connected &&
        item.projectsReady === other.projectsReady &&
        item.usedProjects.length === other.usedProjects.length &&
        item.usedProjects.every(
          (project, at) =>
            project.id === other.usedProjects[at]!.id && project.worktree === other.usedProjects[at]!.worktree,
        )
      )
    })
  )
}

function findProject(server: HomeServerSnapshot, directory: string) {
  const key = pathKey(directory)

  return server.usedProjects.find((project) => pathKey(project.worktree) === key)
}

// A new object every time: `layout.home.setSelection` reconciles it into the layout store.
function selection(server: ServerConnection.Key | undefined, directory: string | undefined): HomeProjectSelection {
  if (!server) return {}

  return directory ? { server, directory } : { server }
}
