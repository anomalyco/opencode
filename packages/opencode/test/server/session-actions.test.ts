import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import os from "os"
import { Instance } from "../../src/project/instance"
import { eq, Database } from "../../src/storage/db"
import { Server } from "../../src/server/server"
import { Plugin } from "../../src/plugin"
import { Session } from "../../src/session"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionTable } from "../../src/session/session.sql"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

async function user(sessionID: SessionID, text: string) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
    time: { created: Date.now() },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    sessionID,
    messageID: msg.id,
    type: "text",
    text,
  })
  return msg
}

describe("session action routes", () => {
  test("abort route calls SessionPrompt.cancel", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const cancel = spyOn(SessionPrompt, "cancel").mockResolvedValue()
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/abort`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toBe(true)
        expect(cancel).toHaveBeenCalledWith(session.id)

        await Session.remove(session.id)
      },
    })
  })

  test("delete message route returns 400 when session is busy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const busy = spyOn(SessionPrompt, "assertNotBusy").mockRejectedValue(new Session.BusyError(session.id))
        const remove = spyOn(Session, "removeMessage").mockResolvedValue(msg.id)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/message/${msg.id}`, {
          method: "DELETE",
        })

        expect(res.status).toBe(400)
        expect(busy).toHaveBeenCalledWith(session.id)
        expect(remove).not.toHaveBeenCalled()

        await Session.remove(session.id)
      },
    })
  })

  test("revert route hydrates session before reverting", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const trigger = spyOn(Plugin, "trigger").mockResolvedValue({})
        const revert = spyOn(SessionRevert, "revert").mockResolvedValue(session)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/revert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageID: msg.id }),
        })

        expect(res.status).toBe(200)
        expect(trigger).toHaveBeenCalledWith("session.ensure.before", { sessionID: session.id, mode: "revert" }, {})
        expect(revert).toHaveBeenCalledWith({ sessionID: session.id, messageID: msg.id })

        await Session.remove(session.id)
      },
    })
  })

  test("unrevert route hydrates session before unreverting", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const trigger = spyOn(Plugin, "trigger").mockResolvedValue({})
        const unrevert = spyOn(SessionRevert, "unrevert").mockResolvedValue(session)
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/unrevert`, {
          method: "POST",
        })

        expect(res.status).toBe(200)
        expect(trigger).toHaveBeenCalledWith("session.ensure.before", { sessionID: session.id, mode: "unrevert" }, {})
        expect(unrevert).toHaveBeenCalledWith({ sessionID: session.id })

        await Session.remove(session.id)
      },
    })
  })

  test("revert route supports conversation-only mode", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        const app = Server.Default()

        const res = await app.request(`/session/${session.id}/revert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageID: msg.id, mode: "conversation" }),
        })

        expect(res.status).toBe(200)
        const body = (await res.json()) as Session.Info
        expect(body.revert?.messageID).toBe(msg.id)
        expect(body.revert?.snapshot).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })

  test("foreign-machine revert auto-downgrades to conversation-only mode", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const host = spyOn(os, "hostname").mockReturnValue("machine-b")
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        Database.use((db) =>
          db.update(SessionTable).set({ origin_machine: "machine-a" }).where(eq(SessionTable.id, session.id)).run(),
        )

        const app = Server.Default()
        const res = await app.request(`/session/${session.id}/revert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageID: msg.id }),
        })

        expect(res.status).toBe(200)
        const body = (await res.json()) as Session.Info
        expect(body.revert?.mode).toBe("conversation")
        expect(body.revert?.snapshot).toBeUndefined()

        host.mockRestore()
        await Session.remove(session.id)
      },
    })
  })

  test("unknown-origin revert also downgrades to conversation-only mode", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await user(session.id, "hello")
        Database.use((db) =>
          db.update(SessionTable).set({ origin_machine: null }).where(eq(SessionTable.id, session.id)).run(),
        )

        const app = Server.Default()
        const res = await app.request(`/session/${session.id}/revert`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messageID: msg.id }),
        })

        expect(res.status).toBe(200)
        const body = (await res.json()) as Session.Info
        expect(body.revert?.mode).toBe("conversation")
        expect(body.revert?.snapshot).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })
})
