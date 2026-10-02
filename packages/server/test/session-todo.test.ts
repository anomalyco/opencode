import { describe, expect, test } from "bun:test"
import { webHandler } from "../src/routes"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionTodo } from "@opencode-ai/core/session/todo"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"

describe("session.todo endpoint", () => {
  const auth = { authorization: "Basic " + btoa("opencode:") }

  test("returns 404 for non-existent session", async () => {
    const { handler, dispose } = webHandler()
    try {
      const res = await handler(
        new Request("http://localhost/api/session/ses_nonexistent/todo", { headers: auth }),
      )
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body._tag).toBe("SessionNotFoundError")
    } finally {
      await dispose()
    }
  })

  test("returns empty todo list for new session", async () => {
    const { handler, dispose } = webHandler()
    try {
      const createRes = await handler(
        new Request("http://localhost/api/session", {
          method: "POST",
          headers: { ...auth, "content-type": "application/json" },
          body: JSON.stringify({}),
        }),
      )
      expect(createRes.status).toBe(200)
      const session = await createRes.json()
      const sid = session.data.id

      // Test v2 endpoint
      const v2Res = await handler(
        new Request(`http://localhost/api/session/${sid}/todo`, { headers: auth }),
      )
      expect(v2Res.status).toBe(200)
      const v2Body = await v2Res.json()
      expect(v2Body.data).toEqual([])

      // Test legacy endpoint
      const legacyRes = await handler(
        new Request(`http://localhost/session/${sid}/todo`, { headers: auth }),
      )
      expect(legacyRes.status).toBe(200)
      const legacyBody = await legacyRes.json()
      expect(legacyBody.data).toEqual([])
    } finally {
      await dispose()
    }
  })
})
