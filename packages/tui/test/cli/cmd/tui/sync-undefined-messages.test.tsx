/** @jsxImportSource @opentui/solid */
/**
 * Reproducer for #26560 — TUI crashes with
 *   `TypeError: undefined is not an object (evaluating 'f.data.map')`
 * when entering a session whose messages endpoint returns a non-2xx.
 * The failure path is `sync.tsx#sync.session.sync` reading
 * `messages.data!` while the SDK leaves `data` undefined on error.
 */
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../../../fixture/fixture"
import { directory, json, mount } from "./sync-fixture"

const sessionID = "ses_undef"

describe("tui sync (#26560)", () => {
  test("entering a session whose messages endpoint errors does not crash sync", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")

    const sessionPayload = {
      id: sessionID,
      slug: "broken",
      projectID: "proj_test",
      title: "broken",
      time: { created: 0, updated: 0 },
      version: "1.14.42",
      directory,
      project_id: "proj_test",
    }
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json(sessionPayload)
      if (url.pathname === `/session/${sessionID}/message`) return json({}, { status: 500 })
      if (url.pathname === `/session/${sessionID}/todo`) return json([])
      if (url.pathname === `/session/${sessionID}/diff`) return json([])
      if (url.pathname === "/session") return json([])
      return undefined
    }, tmp.path)

    try {
      await expect(sync.session.sync(sessionID)).resolves.toBeUndefined()
      expect(sync.session.get(sessionID)).toEqual(sessionPayload)
    } finally {
      app.renderer.destroy()
    }
  })

  test("retries message hydration after an initial endpoint error", async () => {
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/kv.json`, "{}")
    let loads = 0
    const sessionPayload = {
      id: sessionID,
      slug: "broken",
      projectID: "proj_test",
      title: "broken",
      time: { created: 0, updated: 0 },
      version: "1.14.42",
      directory,
      project_id: "proj_test",
    }
    const { app, sync } = await mount((url) => {
      if (url.pathname === `/session/${sessionID}`) return json(sessionPayload)
      if (url.pathname === `/session/${sessionID}/message`) {
        loads += 1
        if (loads === 1) return json({}, { status: 500 })
        return json([
          {
            info: {
              id: "msg_retry",
              sessionID,
              role: "user",
              agent: "build",
              model: { providerID: "test", modelID: "model" },
              time: { created: 1 },
            },
            parts: [],
          },
        ])
      }
      if (url.pathname === `/session/${sessionID}/todo`) return json([])
      if (url.pathname === `/session/${sessionID}/diff`) return json([])
      if (url.pathname === "/session") return json([sessionPayload])
      return undefined
    }, tmp.path)

    try {
      await sync.session.sync(sessionID)
      await sync.session.sync(sessionID)

      expect(loads).toBe(2)
      expect(sync.data.message[sessionID].map((message) => message.id)).toEqual(["msg_retry"])
    } finally {
      app.renderer.destroy()
    }
  })
})
