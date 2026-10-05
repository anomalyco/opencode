/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount, wait } from "./sync-fixture"

const sessionID = "ses_old"

const sessionPayload = {
  id: sessionID,
  title: "older than the session list",
  time: { created: 0, updated: 0 },
  version: "1.14.42",
  directory,
  project_id: "proj_test",
}

describe("tui sync: a session outside the session list", () => {
  test("is shown before its messages load and kept through list refreshes", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    let releaseMessages!: () => void
    const messagesHeld = new Promise<void>((resolve) => {
      releaseMessages = resolve
    })
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json(sessionPayload)
      if (url.pathname === `/session/${sessionID}/message`) return messagesHeld.then(() => json([]))
      if (url.pathname === `/session/${sessionID}/todo`) return json([])
      if (url.pathname === `/session/${sessionID}/diff`) return json([])
      if (url.pathname === "/session") return json([])
      return undefined
    }, tmp.path)

    try {
      const syncing = sync.session.sync(sessionID)
      await wait(() => sync.session.get(sessionID) !== undefined)
      releaseMessages()
      await syncing

      await sync.session.refresh()
      expect(sync.session.get(sessionID)?.id).toBe(sessionID)
    } finally {
      app.renderer.destroy()
    }
  })
})
