import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import {
  INITIAL_HOME_SELECTION_STATE,
  selectHomeSelection,
  transitionHomeSelection,
  type HomeEnvSnapshot,
  type HomeSelectionEvent,
  type HomeSelectionState,
  type HomeServerSnapshot,
} from "./machine"

const SIDECAR = ServerConnection.Key.make("sidecar")

const REMOTE = ServerConnection.Key.make("https://apollo.example.test")

const REPO = { id: "proj_repo", worktree: "/srv/repo" }

const API = { id: "proj_api", worktree: "C:/OpenCode/api" }

const APP = { id: "proj_app", worktree: "C:/OpenCode/app" }

const server = (key: ServerConnection.Key, input: Partial<HomeServerSnapshot> = {}): HomeServerSnapshot => ({
  key,
  failed: false,
  connected: true,
  projectsReady: true,
  usedProjects: [],
  ...input,
})

const env = (input: Partial<HomeEnvSnapshot> = {}): HomeEnvSnapshot => ({
  hydrated: true,
  stored: {},
  servers: [server(SIDECAR)],
  ...input,
})

const sync = (state: HomeSelectionState, snapshot: HomeEnvSnapshot) =>
  transitionHomeSelection(state, { type: "env.synced", env: snapshot })

const settle = (snapshot: HomeEnvSnapshot) => sync(INITIAL_HOME_SELECTION_STATE, snapshot).state

describe("home selection machine", () => {
  test("keeps a restored remote selection while the stored servers load, then verifies its project", () => {
    const stored = { server: REMOTE, directory: "/srv/repo" }

    const loading = sync(INITIAL_HOME_SELECTION_STATE, env({ hydrated: false, stored }))
    expect(loading.state.status).toBe("hydrating")
    expect(loading.effects).toEqual([])
    // The fallback server shows without the remote server's directory.
    expect(selectHomeSelection(loading.state)).toEqual({ server: SIDECAR })

    const listed = sync(
      loading.state,
      env({ stored, servers: [server(SIDECAR), server(REMOTE, { projectsReady: false })] }),
    )

    expect(listed.state.status).toBe("verifying")
    expect(listed.effects).toEqual([])
    expect(selectHomeSelection(listed.state)).toEqual(stored)

    const ready = sync(
      listed.state,
      env({ stored, servers: [server(SIDECAR), server(REMOTE, { usedProjects: [REPO] })] }),
    )

    expect(ready.state).toMatchObject({ status: "ready", server: REMOTE, project: REPO })
    expect(ready.effects).toEqual([{ type: "worktrees.list", attempt: 1, server: REMOTE, projectID: REPO.id }])
  })

  test("writes nothing while the layout loads, so its stored selection is not overwritten", () => {
    const early = sync(
      INITIAL_HOME_SELECTION_STATE,
      env({ hydrated: false, stored: { server: SIDECAR }, servers: [server(REMOTE)] }),
    )

    expect(early.state.status).toBe("hydrating")
    expect(early.effects).toEqual([])
    expect(selectHomeSelection(early.state)).toEqual({ server: REMOTE })

    const loaded = sync(
      early.state,
      env({ stored: { server: REMOTE, directory: "/srv/repo" }, servers: [server(REMOTE, { usedProjects: [REPO] })] }),
    )

    expect(loaded.state).toMatchObject({ status: "ready", server: REMOTE, project: REPO })
    expect(loaded.effects.map((effect) => effect.type)).toEqual(["worktrees.list"])
  })

  test("always shows a listed server, and drops the directory of a server that is gone", () => {
    expect(selectHomeSelection(settle(env({ hydrated: false })))).toEqual({ server: SIDECAR })

    const gone = sync(INITIAL_HOME_SELECTION_STATE, env({ stored: { server: REMOTE, directory: "/srv/repo" } }))
    expect(gone.state).toMatchObject({ status: "ready", server: SIDECAR, project: undefined })
    expect(gone.effects).toEqual([{ type: "selection.persist", selection: { server: SIDECAR } }])
  })

  test("waits for legacy projects to migrate before it keeps or clears the directory", () => {
    const stored = { server: SIDECAR, directory: API.worktree }

    const migrating = sync(
      INITIAL_HOME_SELECTION_STATE,
      env({ stored, servers: [server(SIDECAR, { projectsReady: false })] }),
    )

    expect(migrating.state.status).toBe("verifying")
    expect(migrating.effects).toEqual([])

    const migrated = sync(migrating.state, env({ stored, servers: [server(SIDECAR, { usedProjects: [API] })] }))
    expect(migrated.state).toMatchObject({ status: "ready", project: API })
    expect(migrated.effects.map((effect) => effect.type)).toEqual(["worktrees.list"])
  })

  test("stores a used project's own path for a directory written another way", () => {
    const result = sync(
      INITIAL_HOME_SELECTION_STATE,
      env({
        stored: { server: SIDECAR, directory: "C:\\OpenCode\\app\\" },
        servers: [server(SIDECAR, { usedProjects: [APP] })],
      }),
    )

    expect(selectHomeSelection(result.state)).toEqual({ server: SIDECAR, directory: APP.worktree })
    expect(result.effects).toEqual([
      { type: "selection.persist", selection: { server: SIDECAR, directory: APP.worktree } },
      { type: "worktrees.list", attempt: 1, server: SIDECAR, projectID: APP.id },
    ])
  })

  test("lists the selected project's worktrees once per connected span and refreshes only the current one", () => {
    const servers = () => [server(SIDECAR, { usedProjects: [{ ...API }, { ...APP }] })]
    const stored = { server: SIDECAR, directory: API.worktree }
    const listing = settle(env({ stored, servers: servers() }))
    expect(listing.status === "ready" && listing.worktrees).toEqual({
      status: "listing",
      attempt: 1,
      server: SIDECAR,
      projectID: API.id,
    })

    // A store update rebuilds every project object; the demand does not start again.
    expect(sync(listing, env({ stored, servers: servers() }))).toEqual({ state: listing, effects: [] })
    expect(sync(listing, env({ stored, servers: servers() })).state).toBe(listing)

    const listed = transitionHomeSelection(listing, { type: "worktrees.listed", attempt: 1 })
    expect(listed.effects).toEqual([{ type: "worktrees.refresh", server: SIDECAR, projectID: API.id }])
    expect(sync(listed.state, env({ stored, servers: servers() })).state).toBe(listed.state)

    // Switching projects while a list runs drops its refresh.
    const switched = transitionHomeSelection(listing, {
      type: "project.toggled",
      server: SIDECAR,
      directory: APP.worktree,
    })

    expect(switched.effects).toEqual([
      { type: "selection.persist", selection: { server: SIDECAR, directory: APP.worktree } },
      { type: "worktrees.list", attempt: 2, server: SIDECAR, projectID: APP.id },
    ])
    const late = transitionHomeSelection(switched.state, { type: "worktrees.listed", attempt: 1 })
    expect(late.state).toBe(switched.state)
    expect(late.effects).toEqual([])

    // A disconnect drops the demand; the next connection lists again.
    const offline = sync(
      listed.state,
      env({ stored, servers: [server(SIDECAR, { connected: false, usedProjects: [API] })] }),
    )

    expect(offline.state.status === "ready" && offline.state.worktrees).toEqual({ status: "idle" })
    expect(transitionHomeSelection(offline.state, { type: "worktrees.listed", attempt: 1 }).state).toBe(offline.state)
    const online = sync(offline.state, env({ stored, servers: [server(SIDECAR, { usedProjects: [API] })] }))
    expect(online.effects).toEqual([{ type: "worktrees.list", attempt: 2, server: SIDECAR, projectID: API.id }])
  })

  test("a choice made while loading wins once everything loaded, and is written only then", () => {
    const stored = { server: SIDECAR }
    const loading = settle(env({ hydrated: false, stored, servers: [server(SIDECAR), server(REMOTE)] }))
    const focused = transitionHomeSelection(loading, { type: "server.focused", server: REMOTE })
    expect(focused.state.status).toBe("hydrating")
    expect(focused.effects).toEqual([])
    expect(selectHomeSelection(focused.state)).toEqual({ server: REMOTE })

    const loaded = sync(focused.state, env({ stored, servers: [server(SIDECAR), server(REMOTE)] }))
    expect(loaded.effects).toEqual([{ type: "selection.persist", selection: { server: REMOTE } }])
  })

  test("keeps the directory while its server is signed out, and clears it only once the server lists projects", () => {
    const stored = { server: SIDECAR, directory: API.worktree }
    const ready = settle(env({ stored, servers: [server(SIDECAR, { connected: false, usedProjects: [API] })] }))

    const signedOut = sync(
      ready,
      env({ stored, servers: [server(SIDECAR, { connected: false, projectsReady: false })] }),
    )

    expect(signedOut.state.status).toBe("verifying")
    expect(signedOut.effects).toEqual([])

    const closed = sync(signedOut.state, env({ stored, servers: [server(SIDECAR, { connected: false })] }))
    expect(closed.state).toMatchObject({ status: "ready", project: undefined })
    expect(closed.effects).toEqual([{ type: "selection.persist", selection: { server: SIDECAR } }])
  })

  test("toggles a used project on a working server and ignores the rest", () => {
    const servers = [
      server(SIDECAR, { connected: false, usedProjects: [API] }),
      server(REMOTE, { failed: true, usedProjects: [REPO] }),
    ]

    const ready = settle(env({ stored: { server: SIDECAR }, servers }))

    const toggle = (state: HomeSelectionState, target: ServerConnection.Key, directory: string) =>
      transitionHomeSelection(state, { type: "project.toggled", server: target, directory })

    expect(toggle(ready, REMOTE, REPO.worktree).state).toBe(ready)
    expect(toggle(ready, SIDECAR, "C:/OpenCode/unused").state).toBe(ready)

    const on = toggle(ready, SIDECAR, API.worktree)
    expect(on.effects).toEqual([{ type: "selection.persist", selection: { server: SIDECAR, directory: API.worktree } }])
    const off = toggle(on.state, SIDECAR, "C:\\OpenCode\\api\\")
    expect(off.effects).toEqual([{ type: "selection.persist", selection: { server: SIDECAR } }])
  })

  test("an added project is selected unless the user chose something else first", () => {
    const stored = { server: SIDECAR }
    const ready = settle(env({ stored, servers: [server(SIDECAR, { connected: false }), server(REMOTE)] }))
    const add: HomeSelectionEvent = { type: "project.add", server: SIDECAR, directories: [API.worktree] }

    expect(transitionHomeSelection(ready, { ...add, directories: [] }).state).toBe(ready)

    const adding = transitionHomeSelection(ready, add)
    expect(adding.effects).toEqual([{ type: "project.add", attempt: 1, server: SIDECAR, directories: [API.worktree] }])

    // The server reports the project before the result arrives, as the driver syncs it first.
    const listed = sync(
      adding.state,
      env({ stored, servers: [server(SIDECAR, { connected: false, usedProjects: [API] }), server(REMOTE)] }),
    )

    const added = transitionHomeSelection(listed.state, { type: "project.added", attempt: 1, project: API })
    expect(added.state).toMatchObject({ status: "ready", server: SIDECAR, project: API, adding: undefined })
    expect(added.effects).toEqual([
      { type: "selection.persist", selection: { server: SIDECAR, directory: API.worktree } },
    ])

    const moved = transitionHomeSelection(listed.state, { type: "server.focused", server: REMOTE })
    const stale = transitionHomeSelection(moved.state, { type: "project.added", attempt: 1, project: API })
    expect(stale.state).toBe(moved.state)
    expect(stale.effects).toEqual([])

    const failed = transitionHomeSelection(listed.state, { type: "project.added", attempt: 1, project: undefined })
    expect(failed.state).toMatchObject({ status: "ready", project: undefined, adding: undefined })
    expect(failed.effects).toEqual([])
  })

  test("adopts a selection written elsewhere, and does not echo its own writes", () => {
    const servers = [server(SIDECAR, { connected: false, usedProjects: [API] }), server(REMOTE)]
    const first = sync(INITIAL_HOME_SELECTION_STATE, env({ stored: { server: REMOTE, directory: "/gone" }, servers }))
    expect(first.effects).toEqual([{ type: "selection.persist", selection: { server: REMOTE } }])
    expect(sync(first.state, env({ stored: { server: REMOTE }, servers })).state).toBe(first.state)

    const shown = sync(first.state, env({ stored: { server: SIDECAR, directory: API.worktree }, servers }))
    expect(shown.state).toMatchObject({ status: "ready", server: SIDECAR, project: API })
    expect(shown.effects).toEqual([])
  })

  test("ignores everything once disposed", () => {
    const listing = settle(
      env({
        stored: { server: SIDECAR, directory: API.worktree },
        servers: [server(SIDECAR, { usedProjects: [API] })],
      }),
    )

    const disposed = transitionHomeSelection(listing, { type: "disposed" }).state
    expect(disposed.status).toBe("disposed")
    expect(transitionHomeSelection(disposed, { type: "worktrees.listed", attempt: 1 })).toEqual({
      state: disposed,
      effects: [],
    })
    expect(transitionHomeSelection(disposed, { type: "project.added", attempt: 1, project: API }).state).toBe(disposed)
    expect(sync(disposed, env()).state).toBe(disposed)
  })
})
