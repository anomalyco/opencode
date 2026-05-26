import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as Y from "yjs"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Doc } from "../../src/doc"
import * as Room from "../../src/doc/room"
import { AssetID, DocID } from "../../src/doc/schema"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

const prompt = {
  noReply: true,
  parts: [{ type: "text" as const, text: "hi" }],
}

function defer<T>() {
  let done!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolve) => {
    done = resolve
  })
  return { promise, done }
}

describe("doc", () => {
  afterEach(() => {
    mock.restore()
    Server.basePath = "/"
  })

  test("prompt doc and session actor are session-scoped", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})

        const first = Doc.prompt(session.id)
        const second = Doc.prompt(session.id)
        expect(second.docID).toBe(first.docID)

        const actor = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        expect(actor.sessionID).toBe(session.id)
        expect(actor.name).toBe("Alice")

        const again = Doc.actorUpsert({ sessionID: session.id, actorID: actor.actorID })
        expect(again.actorID).toBe(actor.actorID)

        const list = Doc.actorList(session.id)
        expect(list.length).toBe(1)
        expect(list[0]?.actorID).toBe(actor.actorID)
      },
    })
  })

  test("prompt advance rotates session doc after ready", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const first = Doc.prompt(session.id)
        const second = Doc.promptAdvance({ sessionID: session.id })
        expect(second.docID).not.toBe(first.docID)
        expect(Doc.prompt(session.id).docID).toBe(first.docID)

        const ready = Doc.promptReady({ sessionID: session.id, docID: second.docID })
        expect(ready.docID).toBe(second.docID)
        expect(Doc.prompt(session.id).docID).toBe(second.docID)
      },
    })
  })

  test("sync push and pull round-trip", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)

        const ydoc = new Y.Doc()
        ydoc.getText("t").insert(0, "hi")
        const data = Y.encodeStateAsUpdate(ydoc)
        Doc.syncPush({ docID, guid: docID, data: new Uint8Array(data) })

        const pulled = Doc.syncPull({ docID, guid: docID, state: new Uint8Array() })
        expect(pulled).not.toBeNull()
        const remote = new Y.Doc()
        Y.applyUpdate(remote, pulled!.data)
        expect(remote.getText("t").toString()).toBe("hi")
      },
    })
  })

  test("page subdoc push registers root subdoc", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)

        const page = new Y.Doc({ guid: "page" })
        page.getText("t").insert(0, "hi")
        Doc.syncPush({ docID, guid: "page", data: new Uint8Array(Y.encodeStateAsUpdate(page)) })

        const root = Doc.syncPull({ docID, guid: docID, state: new Uint8Array() })
        expect(root).not.toBeNull()

        const remote = new Y.Doc({ guid: docID })
        Y.applyUpdate(remote, root!.data)
        expect(Array.from(remote.getSubdocs()).map((doc) => doc.guid)).toContain("page")

        const pulled = Doc.syncPull({ docID, guid: "page", state: new Uint8Array() })
        expect(pulled).not.toBeNull()

        const next = new Y.Doc({ guid: "page" })
        Y.applyUpdate(next, pulled!.data)
        expect(next.getText("t").toString()).toBe("hi")
      },
    })
  })

  test("doc asset stores image data for other clients", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const data = new Uint8Array([1, 2, 3])

        const asset = Doc.assetCreate({ docID, mime: "image/png", data })
        expect(asset.url).toBe(`/doc/${docID}/asset/${asset.assetID}`)

        const next = Doc.assetGet({ docID, assetID: asset.assetID })
        expect(next.mime).toBe("image/png")
        expect(next.size).toBe(3)
        expect(Array.from(next.data)).toEqual([1, 2, 3])

        const keyed = Doc.assetCreate({ docID, assetID: AssetID.make("hash"), mime: "image/png", data })
        expect(keyed.assetID).toBe(AssetID.make("hash"))
        expect(Doc.assetGet({ docID, assetID: AssetID.make("hash") }).size).toBe(3)
      },
    })
  })

  test("doc asset route returns uploaded asset data", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const app = Server.Default()

        const dir = encodeURIComponent(tmp.path)
        const upload = await app.request(`/doc/${docID}/asset?directory=${dir}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "hash",
            mime: "image/png",
            data: Buffer.from([4, 5, 6]).toString("base64"),
          }),
        })
        expect(upload.status).toBe(200)

        const info = (await upload.json()) as Doc.AssetInfo
        expect(info.assetID).toBe(AssetID.make("hash"))
        expect(info.url).toBe(`/doc/${docID}/asset/${info.assetID}?directory=${dir}`)
        expect(Doc.assetGet({ docID, assetID: info.assetID }).size).toBe(3)
        const image = await app.request(info.url)
        expect(image.status).toBe(200)
        expect(image.headers.get("content-type")).toBe("image/png")
        expect(Array.from(new Uint8Array(await image.arrayBuffer()))).toEqual([4, 5, 6])

        Server.basePath = "/user/alice"
        const res = await app.request(`/doc/${docID}/asset?directory=${dir}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "hash2",
            mime: "image/png",
            data: Buffer.from([7, 8, 9]).toString("base64"),
          }),
        })
        expect(res.status).toBe(200)
        const pref = (await res.json()) as Doc.AssetInfo
        expect(pref.url).toBe(`/user/alice/doc/${docID}/asset/${pref.assetID}?directory=${dir}`)

        Server.basePath = "/"
        const pdf = await app.request(`/doc/${docID}/asset?directory=${dir}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "pdf",
            mime: "application/pdf",
            data: Buffer.from([10, 11, 12]).toString("base64"),
          }),
        })
        expect(pdf.status).toBe(200)
        const file = (await pdf.json()) as Doc.AssetInfo
        expect(file.mime).toBe("application/pdf")
        const fetched = await app.request(file.url)
        expect(fetched.status).toBe(200)
        expect(fetched.headers.get("content-type")).toBe("application/pdf")
        expect(Array.from(new Uint8Array(await fetched.arrayBuffer()))).toEqual([10, 11, 12])

        const html = await app.request(`/doc/${docID}/asset?directory=${dir}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: "html",
            mime: "text/html",
            data: Buffer.from("<script>alert(1)</script>").toString("base64"),
          }),
        })
        expect(html.status).toBe(200)
        const unsafe = (await html.json()) as Doc.AssetInfo
        expect(unsafe.mime).toBe("application/octet-stream")
        const bin = await app.request(unsafe.url)
        expect(bin.status).toBe(200)
        expect(bin.headers.get("content-type")).toBe("application/octet-stream")
        expect(bin.headers.get("content-disposition")).toBe('attachment; filename="html"')
        expect(bin.headers.get("x-content-type-options")).toBe("nosniff")
      },
    })
  })

  test("new peers receive current awareness state", () => {
    const docID = DocID.ascending()
    const first: Uint8Array[] = []
    const second: Uint8Array[] = []
    const one: Room.Peer = { send: (data) => first.push(data) }
    const two: Room.Peer = { send: (data) => second.push(data) }

    const stopOne = Room.connect(docID, one)
    Room.awareness(docID, new Uint8Array([1, 2, 3]), one)
    const stopTwo = Room.connect(docID, two)

    expect(second.some((data) => Room.decode(data, docID)?.type === Room.MSG_AWARENESS)).toBe(true)

    stopTwo()
    stopOne()
  })

  test("submit approval broadcasts created and reconnect receives pending state", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const bob = Doc.actorUpsert({ sessionID: session.id, name: "Bob" })
        const events: Doc.SubmitEvent[] = []
        const stop = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: (data) => events.push(JSON.parse(data) as Doc.SubmitEvent) },
        })

        const state = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt,
        })
        expect(state.status).toBe("pending")
        expect(events[0]?.type).toBe("created")
        expect(events[0]?.state.submitID).toBe(state.submitID)

        const current: Doc.SubmitEvent[] = []
        const close = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: (data) => current.push(JSON.parse(data) as Doc.SubmitEvent) },
        })
        expect(current[0]?.type).toBe("created")
        expect(current[0]?.state.submitID).toBe(state.submitID)

        close()
        stop()
      },
    })
  })

  test("submit approval clamps timeout and auto-approves initiator", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const bob = Doc.actorUpsert({ sessionID: session.id, name: "Bob" })
        const stop = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: () => undefined },
        })

        const min = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt,
          timeoutMs: 1,
        })
        expect(min.timeoutMs).toBe(10_000)
        expect(min.actors.find((actor) => actor.actorID === alice.actorID)?.status).toBe("approved")

        Doc.submitRespond({
          sessionID: session.id,
          submitID: min.submitID,
          actorID: bob.actorID,
          action: "cancel",
        })

        const max = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt,
          timeoutMs: 900_000,
        })
        expect(max.timeoutMs).toBe(600_000)

        Doc.submitRespond({
          sessionID: session.id,
          submitID: max.submitID,
          actorID: bob.actorID,
          action: "cancel",
        })

        const base = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt,
        })
        expect(base.timeoutMs).toBe(120_000)
        stop()
      },
    })
  })

  test("submit approval sends on last approval and ignores later cancel", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const bob = Doc.actorUpsert({ sessionID: session.id, name: "Bob" })
        const stop = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: () => undefined },
        })
        const state = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt,
        })

        const sent = Doc.submitRespond({
          sessionID: session.id,
          submitID: state.submitID,
          actorID: bob.actorID,
          action: "approve",
        })
        expect(sent.status).toBe("sent")

        const next = Doc.submitRespond({
          sessionID: session.id,
          submitID: state.submitID,
          actorID: bob.actorID,
          action: "cancel",
        })
        expect(next.status).toBe("sent")
        stop()
      },
    })
  })

  test("submit approval rotates prompt doc after sent before assistant finishes", async () => {
    const ready = defer<void>()
    spyOn(SessionPrompt, "prompt").mockImplementation((input) => {
      if (input.noReply === true) return Promise.resolve(undefined as never)
      ready.done()
      return new Promise<never>(() => {})
    })
    spyOn(SessionPrompt, "loop").mockImplementation(() => {
      ready.done()
      return new Promise<never>(() => {})
    })

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const bob = Doc.actorUpsert({ sessionID: session.id, name: "Bob" })
        const stop = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: () => undefined },
        })
        const state = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt: {
            parts: [{ type: "text", text: "hi" }],
          },
        })

        const sent = Doc.submitRespond({
          sessionID: session.id,
          submitID: state.submitID,
          actorID: bob.actorID,
          action: "approve",
        })
        expect(sent.status).toBe("sent")

        await Promise.race([
          ready.promise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timed out waiting for assistant")), 1000),
          ),
        ])
        expect(Doc.prompt(session.id).docID).not.toBe(docID)
        stop()
      },
    })
  })

  test("submit approval cancels for everyone and ignores later approval", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const bob = Doc.actorUpsert({ sessionID: session.id, name: "Bob" })
        const stop = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: () => undefined },
        })
        const state = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt,
        })

        const cancelled = Doc.submitRespond({
          sessionID: session.id,
          submitID: state.submitID,
          actorID: bob.actorID,
          action: "cancel",
        })
        expect(cancelled.status).toBe("cancelled")
        expect(cancelled.cancelledBy?.actorID).toBe(bob.actorID)

        const next = Doc.submitRespond({
          sessionID: session.id,
          submitID: state.submitID,
          actorID: alice.actorID,
          action: "approve",
        })
        expect(next.status).toBe("cancelled")
        stop()
      },
    })
  })

  test("submit approval ignores disconnected actors from stale client snapshots", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const bob = Doc.actorUpsert({ sessionID: session.id, name: "Bob" })
        const charlie = Doc.actorUpsert({ sessionID: session.id, name: "Charlie" })
        const stop = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: () => undefined },
        })

        const state = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID, charlie.actorID],
          prompt,
        })

        expect(state.status).toBe("pending")
        expect(state.actors.map((actor) => actor.actorID).sort()).toEqual([alice.actorID, bob.actorID].sort())
        stop()
      },
    })
  })
})
