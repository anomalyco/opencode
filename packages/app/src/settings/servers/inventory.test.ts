import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
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

test("settings project inventory reads metadata without acquiring directory stores", () => {
  const projects = Array.from({ length: 40 }, (_, index) => ({
    id: `project-${index}`,
    worktree: `/projects/${index}`,
    name: `Project ${index}`,
    icon: { color: "orange" },
    commands: { start: "bun install" },
    time: { created: 1, updated: 1 },
    sandboxes: [],
    worktrees: [],
  }))
  const tracked = { ...projects[0], expanded: true, icon: { override: "local-icon" } }
  const inventory = settingsProjects({
    projects: { list: () => [tracked], closed: () => [projects[1].worktree] },
    sync: { data: { project: projects } },
  })

  expect(inventory).toHaveLength(39)
  expect(inventory[0]).toBe(tracked)
  expect(inventory.some((project) => project.id === projects[1].id)).toBe(false)
  expect(inventory[1]).toEqual({ ...projects[2], expanded: false })
  expect(inventory[38]).toEqual({ ...projects[39], expanded: false })
})

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
