import { describe, expect, test } from "bun:test"
import { ServerConnection, serverName } from "@/runtime/server/registry"
import type { ExtensionServer } from "@/runtime/extension/servers"
import { settingsServers } from "./inventory"

const ssh: ExtensionServer = {
  key: "ssh:build",
  extension: "ssh",
  entry: { id: "build", name: "Build server", state: "stopped" },
}

const connection: ServerConnection.Extension = {
  type: "extension",
  key: "ssh:build",
  extension: "ssh",
  state: "stopped",
  connecting: false,
  authenticationRequired: false,
  managed: true,
  displayName: "Build server",
  http: { url: "http://127.0.0.1:4000", password: "secret" },
}

describe("settings server inventory", () => {
  test("includes contributed servers before they connect", () => {
    expect(settingsServers([], [ssh], serverName)).toEqual([
      {
        key: ServerConnection.Key.make("ssh:build"),
        name: "Build server",
        source: ssh,
      },
    ])
  })

  test("joins a ready contributed server to its live connection and withholds it while disconnected", () => {
    const ready = { ...ssh, entry: { ...ssh.entry, state: "ready" as const } }
    expect(settingsServers([connection], [ready], serverName)).toEqual([
      {
        key: ServerConnection.Key.make("ssh:build"),
        name: "Build server",
        connection,
        source: ready,
      },
    ])
    expect(settingsServers([connection], [ssh], serverName)[0].connection).toBeUndefined()
  })
})
