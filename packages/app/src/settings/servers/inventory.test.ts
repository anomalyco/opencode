import { describe, expect, test } from "bun:test"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import type { PluginServer } from "@/runtime/plugin/servers"
import { settingsServers } from "./inventory"

const ssh: PluginServer = {
  key: "ssh:build",
  plugin: "ssh",
  entry: { id: "build", name: "Build server", state: "stopped" },
}

const connection: ServerConnection.Plugin = {
  type: "plugin",
  key: "ssh:build",
  plugin: "ssh",
  status: { type: "stopped" },
  authenticate: () => false,
  managed: true,
  displayName: "Build server",
}

const unknown = () => ({})

describe("settings server inventory", () => {
  test("includes contributed servers before they connect", () => {
    expect(settingsServers([], [ssh], serverName, unknown)).toEqual([
      {
        key: ServerConnection.Key.make("ssh:build"),
        name: "Build server",
        source: ssh,
        availability: { status: "unreachable", reason: "stopped" },
      },
    ])
  })

  test("joins a ready contributed server to its live connection and withholds it while disconnected", () => {
    const ready = { ...ssh, entry: { ...ssh.entry, state: "ready" as const } }
    const live = { ...connection, status: { type: "ready" as const, http: { url: "http://127.0.0.1:4100" } } }
    expect(settingsServers([live], [ready], serverName, unknown)).toEqual([
      {
        key: ServerConnection.Key.make("ssh:build"),
        name: "Build server",
        connection: live,
        source: ready,
        availability: { status: "ready", connection: live, health: undefined },
      },
    ])
    expect(settingsServers([connection], [ssh], serverName, unknown)[0].connection).toBeUndefined()
  })
})
