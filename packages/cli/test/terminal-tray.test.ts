import { describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createTerminalTray, hasDesktop } from "../src/services/terminal-tray"
import type { TerminalTray } from "@opencode/schema/terminal-tray"

describe("terminal tray bridge", () => {
  test("enables the companion only for local graphical interactive terminals", () => {
    expect(hasDesktop({}, "darwin", true)).toBe(true)
    expect(hasDesktop({}, "win32", true)).toBe(true)
    expect(hasDesktop({ DISPLAY: ":0" }, "linux", true)).toBe(true)
    expect(hasDesktop({}, "linux", true)).toBe(false)
    expect(hasDesktop({ SSH_CONNECTION: "remote" }, "darwin", true)).toBe(false)
    expect(hasDesktop({ OPENCODE_TRAY: "false" }, "darwin", true)).toBe(false)
    expect(hasDesktop({}, "darwin", false)).toBe(false)
  })

  test("authenticates the bridge, publishes tabs, routes actions, and cleans up", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-terminal-tray-"))
    const launched: string[] = []
    const focused: boolean[] = []
    const commands: TerminalTray.Command[] = []
    const bridge = await createTerminalTray({
      endpoint: {
        url: "http://127.0.0.1:4096",
        auth: { type: "basic", username: "opencode", password: "test-password" },
      },
      directory,
      enabled: false,
      launch: async (file) => {
        launched.push(file)
      },
      focus: () => {
        focused.push(true)
      },
      log: (message) => {
        throw new Error(message)
      },
    })
    try {
      expect((await fetch(`${bridge.connection.url}/state`)).status).toBe(401)
      const headers = { authorization: `Bearer ${bridge.connection.token}` }
      bridge.update({ enabled: true, focused: true, sessions: ["ses_one"], current: "ses_one" })
      expect(launched).toHaveLength(1)
      expect(JSON.parse(await readFile(launched[0], "utf8"))).toEqual(bridge.connection)
      expect((await stat(launched[0])).mode & 0o777).toBe(0o600)
      const state = await fetch(`${bridge.connection.url}/state`, { headers }).then((response) => response.json())
      expect(state.sessions).toEqual(["ses_one"])
      expect(state.server.url).toBe("http://127.0.0.1:4096")
      expect(
        (
          await fetch(`${bridge.connection.url}/command`, {
            method: "POST",
            headers,
            body: JSON.stringify({ type: "new" }),
          })
        ).status,
      ).toBe(204)
      const unsubscribe = bridge.subscribe((command) => commands.push(command))
      expect(commands).toEqual([{ type: "new" }])
      await fetch(`${bridge.connection.url}/command`, {
        method: "POST",
        headers,
        body: JSON.stringify({ type: "session", sessionID: "ses_one" }),
      })
      expect(commands.at(-1)).toEqual({ type: "session", sessionID: "ses_one" })
      expect(focused).toHaveLength(2)
      expect(
        (
          await fetch(`${bridge.connection.url}/command`, {
            method: "POST",
            headers,
            body: JSON.stringify({ type: "invalid" }),
          })
        ).status,
      ).toBe(400)
      bridge.update({ enabled: true, focused: true, sessions: ["ses_one"] })
      expect(launched).toHaveLength(1)
      bridge.update({ enabled: false, focused: true, sessions: ["ses_one"] })
      bridge.update({ enabled: true, focused: true, sessions: ["ses_one"] })
      expect(launched).toHaveLength(2)
      unsubscribe()
    } finally {
      await bridge.close()
      await rm(directory, { recursive: true, force: true })
    }
    await expect(fetch(`${bridge.connection.url}/state`)).rejects.toThrow()
  })
})
