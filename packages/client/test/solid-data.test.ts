import { expect, mock, test } from "bun:test"
import type { OpenCodeClient, OpenCodeEvent, Project, SessionInfo } from "../src/promise"
import { createServerData, type CreateServerDataInput } from "../src/solid/data"
import { createRoot } from "solid-js"

const session = {
  id: "ses_fork",
  parentID: "ses_parent",
  projectID: "pro_1",
  title: "Fork",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  location: { directory: "/repo" },
} as SessionInfo

const project = {
  id: "pro_1",
  name: "Repo",
  directory: "/repo",
  canonical: "/repo",
  vcs: "git",
  sandboxes: [],
  time: { created: 1, updated: 1 },
} as Project

test("refreshes forked sessions and worktree projects from events", async () => {
  const listeners = new Set<(event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void>()
  const sessionGet = mock(async () => session)
  const projectList = mock(async () => [project])
  const api = {
    session: { get: sessionGet },
    project: { list: projectList },
  } as unknown as OpenCodeClient
  const event = {
    on: (() => () => {}) as CreateServerDataInput["event"]["on"],
    listen(handler: (event: { name: OpenCodeEvent["type"]; details: OpenCodeEvent }) => void) {
      listeners.add(handler)
      return () => listeners.delete(handler)
    },
  }
  const emit = (details: OpenCodeEvent) => listeners.forEach((listener) => listener({ name: details.type, details }))

  await new Promise<void>((resolve) => {
    createRoot((dispose) => {
      const data = createServerData({ api: () => api, directory: "/repo", event, connection: { status: () => "connected" } })
      emit({ type: "session.forked", data: { sessionID: session.id } } as unknown as OpenCodeEvent)
      emit({ type: "worktree.updated", data: { projectID: project.id } } as unknown as OpenCodeEvent)
      void Promise.all([sessionGet, projectList].map((fn) => fn.mock.results[0]?.value)).then(() => {
        expect(data.session.get(session.id)).toEqual(session)
        expect(data.project.get(project.id)).toEqual(project)
        expect(sessionGet).toHaveBeenCalledTimes(1)
        expect(projectList).toHaveBeenCalledTimes(1)
        dispose()
        resolve()
      })
    })
  })
})

test("resolves location info through the requested ref after canonicalization", async () => {
  const requested = { directory: "/repo/../repo" }
  const canonical = {
    directory: "/repo",
    project: { id: "pro_1", directory: "/repo", canonical: "/repo" },
  }
  const api = {
    location: { get: mock(async () => canonical) },
  } as unknown as OpenCodeClient
  const event = {
    on: (() => () => {}) as CreateServerDataInput["event"]["on"],
    listen: () => () => {},
  } as CreateServerDataInput["event"]

  await new Promise<void>((resolve) => {
    createRoot((dispose) => {
      const data = createServerData({ api: () => api, directory: requested.directory, event })
      void data.location.syncInfo(requested).then(() => {
        expect(data.location.info(requested)).toEqual(canonical)
        expect(data.location.info({ directory: canonical.directory })).toEqual(canonical)
        dispose()
        resolve()
      })
    })
  })
})
