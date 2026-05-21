import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Session } from "../../src/session"
import { Doc } from "../../src/doc"
import * as Room from "../../src/doc/room"
import { AssetID, DocID } from "../../src/doc/schema"
import { Project } from "../../src/project/project"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

describe("doc", () => {
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

  test("doc asset route returns uploaded image data", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const app = Server.Default()

        const upload = await app.request(`/doc/${docID}/asset`, {
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
        expect(Doc.assetGet({ docID, assetID: info.assetID }).size).toBe(3)
        const image = await app.request(`/doc/${docID}/asset/${info.assetID}?directory=${encodeURIComponent(tmp.path)}`)
        expect(image.status).toBe(200)
        expect(image.headers.get("content-type")).toBe("image/png")
        expect(Array.from(new Uint8Array(await image.arrayBuffer()))).toEqual([4, 5, 6])
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
})
