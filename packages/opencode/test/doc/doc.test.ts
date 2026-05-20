import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Session } from "../../src/session"
import { Doc } from "../../src/doc"
import * as Room from "../../src/doc/room"
import { DocID } from "../../src/doc/schema"
import { Project } from "../../src/project/project"
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

  test("prompt advance rotates session doc", async () => {
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
        const current = Doc.prompt(session.id)
        expect(current.docID).toBe(second.docID)
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
