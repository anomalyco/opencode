import { describe, expect, test } from "bun:test"
import { createStore, unwrap } from "solid-js/store"
import { createServerProjects, ServerConnection } from "@/runtime/server/registry"
import { ServerScope } from "@/runtime/server/scope"
import type { SshItem } from "@/servers/ssh/types"
import { settingsProjects, settingsServers } from "./inventory"

const ssh: SshItem = {
  config: { id: "build", target: "dev@example.com", name: "Build server" },
  saved: true,
  stage: "disconnected",
  detail: "",
}
const connection: ServerConnection.Ssh = {
  type: "ssh",
  id: ssh.config.id,
  host: ssh.config.target,
  displayName: ssh.config.name,
  http: { url: "http://127.0.0.1:4000", password: "secret" },
}

describe("settings server inventory", () => {
  test("includes saved SSH servers before they connect", () => {
    expect(settingsServers([], [], [ssh])).toEqual([
      {
        key: ServerConnection.Key.make("ssh:build"),
        name: "Build server",
        ssh,
      },
    ])
  })

  test("joins ready SSH state to its live connection", () => {
    const ready = { ...ssh, stage: "ready" as const }
    expect(settingsServers([connection], [], [ready])).toEqual([
      {
        key: ServerConnection.Key.make("ssh:build"),
        name: "Build server",
        connection,
        ssh: ready,
        wsl: undefined,
      },
    ])
  })

  test("omits unsaved SSH state and withholds stale connections while disconnected", () => {
    expect(settingsServers([], [], [{ ...ssh, saved: false }])).toEqual([])
    expect(settingsServers([connection], [], [ssh])[0].connection).toBeUndefined()
  })
})

test("closed projects stay out of settings across persistence and reopen normally", () => {
  const [store, setStore] = createStore<Parameters<typeof createServerProjects>[0]["store"]>({
    list: [],
    hidden: {},
    projects: {},
    lastProject: {},
    recentlyClosed: {},
  })
  const scope = () => ServerScope.fromServerKey(ServerConnection.Key.make("http://localhost:4096"))
  const projects = {
    ...createServerProjects({ scope, store, setStore }),
    resolve: (project: { worktree: string; expanded: boolean }) => project,
  }
  const sync = {
    data: {
      project: Array.from({ length: 20 }, (_, index) => ({
        id: `project-${index}`,
        worktree: `/projects/${index}`,
        time: { created: 1, updated: 1 },
        sandboxes: [],
        worktrees: [],
      })),
    },
  }
  projects.open("/projects/0")
  expect(settingsProjects({ projects, sync })).toHaveLength(20)
  sync.data.project.forEach((project) => projects.close(project.worktree))
  expect(settingsProjects({ projects, sync })).toEqual([])
  expect(projects.list()).toEqual([])
  expect(sync.data.project).toHaveLength(20)

  const [restored, setRestored] = createStore(structuredClone(unwrap(store)))
  const reopened = {
    ...createServerProjects({ scope, store: restored, setStore: setRestored }),
    resolve: projects.resolve,
  }
  expect(settingsProjects({ projects: reopened, sync })).toEqual([])
  reopened.open("/projects/0")
  expect(settingsProjects({ projects: reopened, sync }).map((project) => project.worktree)).toEqual(["/projects/0"])
  expect(reopened.closed()).not.toContain("/projects/0")
})
