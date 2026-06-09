import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import * as Y from "yjs"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { Doc } from "../../src/doc"
import * as Room from "../../src/doc/room"
import { Database } from "../../src/storage/db"
import { DocSubmitTable, DocSubmitActorTable } from "../../src/doc/doc.sql"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import * as CycleRecorder from "../../src/doc/cycle-recorder"
import { eq } from "drizzle-orm"
import { AssetID, CycleID, DocID } from "../../src/doc/schema"
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

  test("recover expires overdue pending submits after a restart", async () => {
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

        // Simulate a restart: the deadline has passed but the in-memory timer is gone.
        Database.use((db) =>
          db
            .update(DocSubmitTable)
            .set({ expires_at: Date.now() - 1_000 })
            .where(eq(DocSubmitTable.id, state.submitID))
            .run(),
        )
        events.length = 0

        Doc.recover()

        // The overdue submit is expired (freeing the pending unique index) and the cast reaches peers.
        expect(events.some((event) => event.type === "expired")).toBe(true)
        expect(Doc.submitActive({ sessionID: session.id, docID, actorID: alice.actorID })).toBeUndefined()

        // The doc is unblocked: a fresh submit can be created.
        const next = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt,
        })
        expect(next.status).toBe("pending")
        expect(next.submitID).not.toBe(state.submitID)

        stop()
      },
    })
  })

  test("submit approval replays a just-resolved terminal state on reconnect", async () => {
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

        const stopBob = Doc.submitConnect({
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

        // Bob rejects, then alice's client reconnects after missing the cancel cast.
        Doc.submitRespond({ sessionID: session.id, submitID: state.submitID, actorID: bob.actorID, action: "cancel" })

        const replay: Doc.SubmitEvent[] = []
        const stopAlice = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          peer: { send: (data) => replay.push(JSON.parse(data) as Doc.SubmitEvent) },
        })
        expect(replay[0]?.type).toBe("cancelled")
        expect(replay[0]?.state.submitID).toBe(state.submitID)
        expect(replay[0]?.state.cancelledBy?.actorID).toBe(bob.actorID)

        // A participant who was not part of the resolved submit gets no replay.
        const carol = Doc.actorUpsert({ sessionID: session.id, name: "Carol" })
        const none: Doc.SubmitEvent[] = []
        const stopCarol = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: carol.actorID,
          peer: { send: (data) => none.push(JSON.parse(data) as Doc.SubmitEvent) },
        })
        expect(none.length).toBe(0)

        stopCarol()
        stopAlice()
        stopBob()
      },
    })
  })

  test("submit approval only targets connected peers", async () => {
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
        const carol = Doc.actorUpsert({ sessionID: session.id, name: "Carol" })

        // Only Bob has a live submit connection. Carol is registered but not connected.
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
          actorIDs: [alice.actorID, bob.actorID, carol.actorID],
          prompt,
        })

        const ids = state.actors.map((actor) => actor.actorID)
        expect(ids).toContain(alice.actorID)
        expect(ids).toContain(bob.actorID)
        // Carol is in the doc roster but has no live connection — she is not a target.
        expect(ids).not.toContain(carol.actorID)

        stop()
      },
    })
  })

  test("submit approval caps overly long names", async () => {
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
          names: { [bob.actorID]: "x".repeat(200) },
          prompt,
        })

        const stored = state.actors.find((actor) => actor.actorID === bob.actorID)
        expect(stored?.name.length).toBe(64)

        stop()
      },
    })
  })

  test("submit approval uses presence names over stored actor fallback", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const { docID } = Doc.prompt(session.id)
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        // Bob registered without a real name, so the stored row is a Guest fallback.
        const bob = Doc.actorUpsert({ sessionID: session.id })

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
          names: { [bob.actorID]: "Bob" },
          prompt,
        })

        const stored = state.actors.find((actor) => actor.actorID === bob.actorID)
        expect(stored?.name).toBe("Bob")
        expect(stored?.name).not.toBe(bob.actorID)

        stop()
      },
    })
  })

  test("submit approval fails when a participant disconnects past the grace period", async () => {
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

        const aliceEvents: Doc.SubmitEvent[] = []
        const stopAlice = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          peer: { send: (data) => aliceEvents.push(JSON.parse(data) as Doc.SubmitEvent) },
        })
        let stopBob = Doc.submitConnect({
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
        expect(state.status).toBe("pending")

        // Bob drops but reconnects inside the 2s grace window — no failure.
        stopBob()
        expect(aliceEvents.some((event) => event.type === "left")).toBe(false)
        stopBob = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: () => undefined },
        })
        await new Promise((resolve) => setTimeout(resolve, 2_200))
        expect(aliceEvents.some((event) => event.type === "left")).toBe(false)
        expect(Doc.submitActive({ sessionID: session.id, docID, actorID: alice.actorID })?.status).toBe("pending")

        // Bob drops and stays gone past the grace window — submit fails as "left".
        stopBob()
        await new Promise((resolve) => setTimeout(resolve, 2_200))

        const left = aliceEvents.find((event) => event.type === "left")
        expect(left).toBeDefined()
        expect(left?.state.status).toBe("left")
        expect(left?.state.cancelledBy?.actorID).toBe(bob.actorID)
        expect(left?.state.cancelledBy?.name).toBe("Bob")

        // The submit is no longer active, so it can never be sent.
        const active = Doc.submitActive({ sessionID: session.id, docID, actorID: alice.actorID })
        expect(active).toBeUndefined()

        stopAlice()
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

  function assistantInfo(input: {
    sessionID: string
    id: string
    parentID: string
    cost: number
    tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
    created: number
    completed?: number
    finish?: string
    error?: { name: string; data: { message: string } }
  }) {
    return {
      id: input.id,
      sessionID: input.sessionID,
      role: "assistant" as const,
      parentID: input.parentID,
      providerID: "anthropic",
      modelID: "claude-sonnet-4-6",
      cost: input.cost,
      tokens: { total: input.tokens.input + input.tokens.output, ...input.tokens },
      time: { created: input.created, completed: input.completed },
      finish: input.finish,
      error: input.error,
    }
  }
  type AInfo = ReturnType<typeof assistantInfo>

  // Persist a user message (+ text/file parts) and one or more assistant-step messages,
  // writing each assistant's full info into its MessageTable row so the recorder can
  // aggregate tokens/cost/response from the DB exactly like the real projector does.
  function seedTurn(input: {
    userText: string
    userTime: number
    userActorID?: string // stamped onto the user text part metadata (solo doc send)
    userDocID?: string // doc the prompt was authored in (text part metadata)
    userFile?: { mime: string; url: string; filename?: string } // an attachment on the prompt
    steps: { info: AInfo; text: string }[] // assistant steps of the turn (all share parentID)
  }) {
    const first = input.steps[0]!.info
    const sessionID = first.sessionID
    const userID = first.parentID
    Database.use((db) => {
      db.insert(MessageTable)
        .values({
          id: userID as never,
          session_id: sessionID as never,
          time_created: input.userTime,
          data: { role: "user", time: { created: input.userTime } } as never,
        })
        .run()
      db.insert(PartTable)
        .values({
          id: `${userID}_p0` as never,
          message_id: userID as never,
          session_id: sessionID as never,
          time_created: input.userTime,
          data: {
            type: "text",
            text: input.userText,
            ...(input.userActorID || input.userDocID
              ? { metadata: { source: "doc", actorID: input.userActorID, docID: input.userDocID } }
              : {}),
          } as never,
        })
        .run()
      if (input.userFile) {
        db.insert(PartTable)
          .values({
            id: `${userID}_pf` as never,
            message_id: userID as never,
            session_id: sessionID as never,
            time_created: input.userTime,
            data: { type: "file", ...input.userFile } as never,
          })
          .run()
      }
      for (const step of input.steps) {
        const { id, sessionID: _sid, ...data } = step.info
        db.insert(MessageTable)
          .values({
            id: step.info.id as never,
            session_id: sessionID as never,
            time_created: step.info.time.created ?? input.userTime + 1,
            data: data as never,
          })
          .run()
        db.insert(PartTable)
          .values({
            id: `${step.info.id}_p0` as never,
            message_id: step.info.id as never,
            session_id: sessionID as never,
            time_created: step.info.time.created ?? input.userTime + 1,
            data: { type: "text", text: step.text } as never,
          })
          .run()
      }
    })
  }

  test("records a prompt cycle when an assistant turn finishes (any prompt path)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_1",
          parentID: "msg_user_1",
          cost: 0.0123,
          tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1200,
          completed: 2000,
          finish: "stop",
        })
        seedTurn({ userText: "hello there", userTime: 1000, steps: [{ info, text: "hello back" }] })
        // This is exactly what the message-updated projector calls for a finished turn.
        Database.use((db) => CycleRecorder.record(db, info as never))

        const cycle = Doc.cycleList({ sessionID: session.id })[0]
        expect(cycle).toBeDefined()
        expect(cycle!.inputs).toHaveLength(1)
        expect(cycle!.inputs[0].docID).toBeNull() // no prompt doc seeded for this session
        expect(cycle!.inputs[0].prompt).toBe("hello there")
        expect(cycle!.inputs[0].userMessageID).toBe("msg_user_1")
        expect(cycle!.inputs[0].seq).toBe(0)
        expect(cycle!.inputs[0].actorIDs).toBeNull() // no actor metadata seeded
        expect(cycle!.inputs[0].consentMs).toBeNull()
        expect(cycle!.response).toBe("hello back")
        expect(cycle!.assistantMessageID).toBe("msg_assistant_1")
        expect(cycle!.tokensInput).toBe(10)
        expect(cycle!.tokensOutput).toBe(20)
        expect(cycle!.costTotal).toBeCloseTo(0.0123)
        expect(cycle!.ttftMs).toBe(200) // output_start(1200) - prompt_start(1000)
        expect(cycle!.aborted).toBe(false)
        expect(cycle!.status).toBe("completed")

        // Single-cycle fetch returns the same record; unknown id returns null.
        expect(Doc.cycleGet({ cycleID: cycle!.id })).toEqual(cycle!)
        expect(Doc.cycleGet({ cycleID: CycleID.zod.parse("cyc_unknown") })).toBeNull()
      },
    })
  })

  test("fills docID from the session's prompt doc even without consent", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        // Opening the prompt doc links session -> doc (no submit / no consent involved).
        const { docID } = Doc.prompt(session.id)
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_d",
          parentID: "msg_user_d",
          cost: 0.01,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1000,
          completed: 1500,
          finish: "stop",
        })
        seedTurn({ userText: "hi", userTime: 1000, steps: [{ info, text: "yo" }] })
        Database.use((db) => CycleRecorder.record(db, info as never))

        const cycle = Doc.cycleList({ sessionID: session.id })[0]
        expect(cycle?.inputs[0].docID).toBe(docID)
        // docID filter matches via the input's doc.
        expect(Doc.cycleList({ docID }).map((c) => c.id)).toContain(cycle!.id)
        expect(cycle?.inputs[0].actorIDs).toBeNull() // still no consent actor
        expect(cycle?.inputs[0].consentMs).toBeNull()
      },
    })
  })

  test("docID comes from the prompt's authored doc (metadata), not the rotated session doc", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        // Session's current prompt doc (may have rotated away from the authored one).
        const { docID: rotatedDocID } = Doc.prompt(session.id)
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_meta",
          parentID: "msg_user_meta",
          cost: 0.01,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1000,
          completed: 1500,
          finish: "stop",
        })
        seedTurn({
          userText: "hi",
          userTime: 1000,
          userDocID: "doc_authored", // the doc the prompt was actually written in
          steps: [{ info, text: "yo" }],
        })
        Database.use((db) => CycleRecorder.record(db, info as never))
        const input = Doc.cycleList({ sessionID: session.id })[0].inputs[0]
        expect(input.docID).toBe("doc_authored" as never) // authored doc, not the session's current
        expect(input.docID).not.toBe(rotatedDocID)
      },
    })
  })

  test("solo send fills actorIDs with the single sender from message metadata", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const me = Doc.actorUpsert({ sessionID: session.id, name: "Me" })
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_solo",
          parentID: "msg_user_solo",
          cost: 0.01,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1000,
          completed: 1500,
          finish: "stop",
        })
        seedTurn({ userText: "hi", userTime: 1000, userActorID: me.actorID, steps: [{ info, text: "yo" }] })
        Database.use((db) => CycleRecorder.record(db, info as never))
        const cycle = Doc.cycleList({ sessionID: session.id })[0]
        expect(cycle?.inputs[0].actorIDs).toEqual([me.actorID]) // exactly one sender
        expect(cycle?.inputs[0].initiatorActorID).toBe(me.actorID) // solo: sender is the initiator
        expect(cycle?.inputs[0].submitID).toBeNull() // no consent submit
        expect(cycle?.inputs[0].consentMs).toBeNull()
      },
    })
  })

  test("multi-party consent fills actorIDs with all approved actors", async () => {
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

        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_multi",
          parentID: "msg_user_multi",
          cost: 0.5,
          tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1200,
          completed: 3000,
          finish: "stop",
        })
        seedTurn({ userText: "team prompt", userTime: 950, steps: [{ info, text: "answer" }] }) // authored before consent

        // Seed a sent submit linked to the user message + its approved actors.
        Database.use((db) => {
          db.insert(DocSubmitTable)
            .values({
              id: "sub_multi" as never,
              session_id: session.id as never,
              target_kind: "doc",
              target_id: docID as never,
              doc_id: docID as never,
              actor_id: alice.actorID as never,
              status: "sent",
              prompt: "{}",
              timeout_ms: 1000,
              expires_at: 9999999999999,
              cancelled_by: null,
              user_message_id: "msg_user_multi" as never,
              time_created: 900,
              time_updated: 1000,
            } as never)
            .run()
          for (const a of [alice, bob]) {
            db.insert(DocSubmitActorTable)
              .values({
                submit_id: "sub_multi" as never,
                actor_id: a.actorID as never,
                name: "x",
                status: "approved",
                time_responded: 1000,
              } as never)
              .run()
          }
        })

        Database.use((db) => CycleRecorder.record(db, info as never))

        const input = Doc.cycleList({ sessionID: session.id })[0].inputs[0]
        expect(input.actorIDs?.sort()).toEqual([alice.actorID, bob.actorID].sort()) // both consenters
        expect(input.initiatorActorID).toBe(alice.actorID) // alice created the submit
        expect(input.submitID).toBe("sub_multi" as never)
        expect(input.actorCount).toBe(2)
        expect(input.consentMs).toBe(100) // 1000 - 900
        // ttft measured from consent (1000), not from authoring (950): 1200 - 1000 = 200.
        expect(Doc.cycleList({ sessionID: session.id })[0].ttftMs).toBe(200)
      },
    })
  })

  test("captures prompt assets (attachments) on the input", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_asset",
          parentID: "msg_user_asset",
          cost: 0.01,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1000,
          completed: 1500,
          finish: "stop",
        })
        seedTurn({
          userText: "look at this",
          userTime: 1000,
          userFile: { mime: "image/png", url: "/doc/doc_x/asset/ast_pic1", filename: "pic.png" },
          steps: [{ info, text: "ok" }],
        })
        Database.use((db) => CycleRecorder.record(db, info as never))
        const input = Doc.cycleList({ sessionID: session.id })[0].inputs[0]
        expect(input.assets).toEqual([
          { assetID: "ast_pic1", mime: "image/png", filename: "pic.png", url: "/doc/doc_x/asset/ast_pic1" },
        ])
      },
    })
  })

  test("assetID is extracted robustly from urls with query strings / trailing slashes", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_assetq",
          parentID: "msg_user_assetq",
          cost: 0.01,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1000,
          completed: 1500,
          finish: "stop",
        })
        seedTurn({
          userText: "x",
          userTime: 1000,
          userFile: { mime: "image/png", url: "/doc/doc_x/asset/ast_q1?sig=abc", filename: "q.png" },
          steps: [{ info, text: "ok" }],
        })
        Database.use((db) => CycleRecorder.record(db, info as never))
        const input = Doc.cycleList({ sessionID: session.id })[0].inputs[0]
        expect(input.assets?.[0].assetID).toBe("ast_q1") // query string stripped, not "ast_q1?sig=abc"
      },
    })
  })

  test("inline data: attachments are recorded without the base64 blob", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_data",
          parentID: "msg_user_data",
          cost: 0.01,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1000,
          completed: 1500,
          finish: "stop",
        })
        seedTurn({
          userText: "describe",
          userTime: 1000,
          userFile: { mime: "image/jpeg", url: "data:image/jpeg;base64,/9j/HUGEBLOB", filename: "shot.jpg" },
          steps: [{ info, text: "ok" }],
        })
        Database.use((db) => CycleRecorder.record(db, info as never))
        const input = Doc.cycleList({ sessionID: session.id })[0].inputs[0]
        // mime/filename kept; url + assetID omitted so the base64 blob isn't duplicated.
        expect(input.assets).toEqual([{ mime: "image/jpeg", filename: "shot.jpg" }])
      },
    })
  })

  test("recording is idempotent per assistant message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_x",
          parentID: "msg_user_x",
          cost: 0.01,
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1000,
          completed: 1500,
          finish: "stop",
        })
        seedTurn({ userText: "hi", userTime: 1000, steps: [{ info, text: "yo" }] })
        // The projector can fire more than once for the same message — must not duplicate.
        Database.use((db) => CycleRecorder.record(db, info as never))
        Database.use((db) => CycleRecorder.record(db, info as never))

        const cycles = Doc.cycleList({ sessionID: session.id })
        expect(cycles).toHaveLength(1)
        expect(cycles[0].inputs).toHaveLength(1)
      },
    })
  })

  test("marks a cycle aborted when the user stops the reply", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const info = assistantInfo({
          sessionID: session.id,
          id: "msg_assistant_2",
          parentID: "msg_user_2",
          cost: 0,
          tokens: { input: 5, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          created: 1000,
          completed: 1500,
          error: { name: "MessageAbortedError", data: { message: "stopped" } },
        })
        seedTurn({ userText: "go", userTime: 1000, steps: [{ info, text: "partial" }] })
        Database.use((db) => CycleRecorder.record(db, info as never))

        const cycle = Doc.cycleList({ sessionID: session.id })[0]
        expect(cycle?.status).toBe("aborted")
        expect(cycle?.aborted).toBe(true)
        expect(cycle?.error).toBe("stopped")
        expect(cycle?.response).toBe("partial")
      },
    })
  })

  test("aggregates a multi-step agent turn into ONE cycle", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        // One user prompt → two assistant messages (e.g. a tool/step then the final answer),
        // both parented to the same user message — exactly the real multi-step loop.
        const step1 = assistantInfo({
          sessionID: session.id,
          id: "msg_a_step1",
          parentID: "msg_user_multistep",
          cost: 0.02,
          tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 1, write: 0 } },
          created: 1100,
          completed: 1200,
          finish: "tool",
        })
        const step2 = assistantInfo({
          sessionID: session.id,
          id: "msg_a_step2",
          parentID: "msg_user_multistep",
          cost: 0.04,
          tokens: { input: 200, output: 30, reasoning: 7, cache: { read: 2, write: 0 } },
          created: 1300,
          completed: 1500,
          finish: "stop",
        })
        seedTurn({
          userText: "do the thing",
          userTime: 1000,
          steps: [
            { info: step1, text: "" }, // intermediate step, no text
            { info: step2, text: "final answer" },
          ],
        })
        // The projector fires per assistant message; both must converge to a single cycle.
        Database.use((db) => CycleRecorder.record(db, step1 as never))
        Database.use((db) => CycleRecorder.record(db, step2 as never))

        const cycles = Doc.cycleList({ sessionID: session.id })
        expect(cycles).toHaveLength(1) // ← the bug: was 2 (one per assistant message)
        const c = cycles[0]
        expect(c.inputs).toHaveLength(1)
        expect(c.inputs[0].prompt).toBe("do the thing")
        expect(c.response).toBe("final answer") // empty step skipped, joined
        expect(c.assistantMessageID).toBe("msg_a_step2") // last step
        expect(c.tokensInput).toBe(300) // 100 + 200 summed
        expect(c.tokensOutput).toBe(40) // 10 + 30
        expect(c.tokensReasoning).toBe(12) // 5 + 7
        expect(c.costTotal).toBeCloseTo(0.06) // 0.02 + 0.04
        expect(c.timeOutputStart).toBe(1100) // first step
        expect(c.timeCompleted).toBe(1500) // last step
        expect(c.ttftMs).toBe(100) // 1100 - 1000
        expect(c.status).toBe("completed")
      },
    })
  })

  test("doc submit transitions to sent and casts when all approve", async () => {
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

        const aliceEvents: Doc.SubmitEvent[] = []
        const stopA = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          peer: { send: (data) => aliceEvents.push(JSON.parse(data) as Doc.SubmitEvent) },
        })
        const bobEvents: Doc.SubmitEvent[] = []
        const stopB = Doc.submitConnect({
          sessionID: session.id,
          docID,
          actorID: bob.actorID,
          peer: { send: (data) => bobEvents.push(JSON.parse(data) as Doc.SubmitEvent) },
        })

        const state = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          prompt,
        })
        expect(state.status).toBe("pending")

        // Bob (the only outstanding approver) approves → all approved → sent.
        const sent = Doc.submitRespond({
          sessionID: session.id,
          submitID: state.submitID,
          actorID: bob.actorID,
          action: "approve",
        })
        expect(sent.status).toBe("sent")
        // Both participants must receive the terminal "sent" cast so their dialogs close.
        expect(aliceEvents.at(-1)?.type).toBe("sent")
        expect(bobEvents.at(-1)?.type).toBe("sent")

        stopA()
        stopB()
      },
    })
  })

  test("submit excludes stale connected peers not in the requester's actorIDs so consensus completes", async () => {
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
        const ghost = Doc.actorUpsert({ sessionID: session.id, name: "Ghost" })

        // All three have live submit sockets, but `ghost` is a stale tab the requester no longer
        // sees in its awareness list.
        const stopA = Doc.submitConnect({ sessionID: session.id, docID, actorID: alice.actorID, peer: { send: () => {} } })
        const stopB = Doc.submitConnect({ sessionID: session.id, docID, actorID: bob.actorID, peer: { send: () => {} } })
        const stopG = Doc.submitConnect({ sessionID: session.id, docID, actorID: ghost.actorID, peer: { send: () => {} } })

        const state = Doc.submitCreate({
          sessionID: session.id,
          docID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID], // ghost intentionally omitted
          prompt,
        })
        // The ghost is not a vote target — only the two real participants are.
        expect(state.actors.map((a) => a.actorID).sort()).toEqual([alice.actorID, bob.actorID].sort())

        const sent = Doc.submitRespond({ sessionID: session.id, submitID: state.submitID, actorID: bob.actorID, action: "approve" })
        expect(sent.status).toBe("sent")

        stopA()
        stopB()
        stopG()
      },
    })
  })

  test("question draft relays shared answers: single is LWW, multi toggles are commutative", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const bob = Doc.actorUpsert({ sessionID: session.id, name: "Bob" })
        const requestID = "question_draft_1"

        const seen: Doc.QuestionChannelEvent[] = []
        const stopA = Doc.questionDraftConnect({
          sessionID: session.id,
          requestID,
          actorID: alice.actorID,
          peer: { send: (data) => seen.push(JSON.parse(data) as Doc.QuestionChannelEvent) },
        })
        const stopB = Doc.questionDraftConnect({
          sessionID: session.id,
          requestID,
          actorID: bob.actorID,
          peer: { send: () => {} },
        })

        // Single-choice: latest pick wins outright.
        Doc.questionDraftApply({ sessionID: session.id, requestID, op: { kind: "single", q: 0, value: "A" } })
        Doc.questionDraftApply({ sessionID: session.id, requestID, op: { kind: "single", q: 0, value: "B" } })
        const afterSingle = seen.filter((e) => e.type === "draft").at(-1)?.draft
        expect(afterSingle?.answers[0]).toEqual(["B"])

        // Multi-choice: independent toggles both land; toggling off removes only that label.
        Doc.questionDraftApply({ sessionID: session.id, requestID, op: { kind: "toggle", q: 1, label: "X", on: true } })
        Doc.questionDraftApply({ sessionID: session.id, requestID, op: { kind: "toggle", q: 1, label: "Y", on: true } })
        expect(seen.filter((e) => e.type === "draft").at(-1)?.draft?.answers[1]).toEqual(["X", "Y"])
        Doc.questionDraftApply({ sessionID: session.id, requestID, op: { kind: "toggle", q: 1, label: "X", on: false } })
        const afterMulti = seen.filter((e) => e.type === "draft").at(-1)?.draft
        expect(afterMulti?.answers[1]).toEqual(["Y"])
        expect(afterMulti?.rev).toBe(5)

        // A late joiner gets the current draft snapshot immediately on connect.
        const late: Doc.QuestionChannelEvent[] = []
        const stopC = Doc.questionDraftConnect({
          sessionID: session.id,
          requestID,
          actorID: bob.actorID,
          peer: { send: (data) => late.push(JSON.parse(data) as Doc.QuestionChannelEvent) },
        })
        expect(late.find((e) => e.type === "draft")?.draft?.answers[0]).toEqual(["B"])

        stopA()
        stopB()
        stopC()
      },
    })
  })

  test("question presence is snapshotted to late joiners and GC'd on resolve", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const requestID = "question_presence_1"

        const stopA = Doc.questionDraftConnect({
          sessionID: session.id,
          requestID,
          actorID: alice.actorID,
          peer: { send: () => {} },
        })
        Doc.questionPresenceSet({
          sessionID: session.id,
          requestID,
          entry: { actorID: alice.actorID, name: "Alice", color: "#fff", qIndex: 0, selection: ["A"], customFocused: false },
        })

        const late: Doc.QuestionChannelEvent[] = []
        const stopB = Doc.questionDraftConnect({
          sessionID: session.id,
          requestID,
          actorID: "actor_late" as never,
          peer: { send: (data) => late.push(JSON.parse(data) as Doc.QuestionChannelEvent) },
        })
        const presence = late.find((e) => e.type === "presence")?.presence
        expect(presence?.[0]?.actorID).toBe(alice.actorID)
        expect(presence?.[0]?.selection).toEqual(["A"])

        // Resolving the question clears the shared state.
        Doc.questionDraftReset(requestID)
        const after: Doc.QuestionChannelEvent[] = []
        const stopC = Doc.questionDraftConnect({
          sessionID: session.id,
          requestID,
          actorID: "actor_late2" as never,
          peer: { send: (data) => after.push(JSON.parse(data) as Doc.QuestionChannelEvent) },
        })
        expect(after.find((e) => e.type === "draft")).toBeUndefined()

        stopA()
        stopB()
        stopC()
      },
    })
  })

  test("question submit route is mounted and validates input", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const app = Server.Default()
        const dir = encodeURIComponent(tmp.path)

        // Empty body → the route is reached and Zod validation rejects it (400), not a 404/fallback.
        const bad = await app.request(`/session/${session.id}/question/submit?directory=${dir}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        })
        expect(bad.status).toBe(400)

        // Valid body → the generalized machine creates a question vote and returns its state.
        const ok = await app.request(`/session/${session.id}/question/submit?directory=${dir}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestID: "question_route_1",
            actorID: alice.actorID,
            actorIDs: [alice.actorID],
            payload: { requestID: "question_route_1", answers: [["A"]] },
          }),
        })
        expect(ok.status).toBe(200)
        const state = (await ok.json()) as Doc.SubmitState
        expect(state.targetKind).toBe("question")
        expect(state.targetID).toBe("question_route_1")
      },
    })
  })

  test("question consent vote keys on requestID and resolves once all approve", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      init: InstanceBootstrap,
      fn: async () => {
        await Project.fromDirectory(tmp.path)
        const session = await Session.create({})
        const alice = Doc.actorUpsert({ sessionID: session.id, name: "Alice" })
        const bob = Doc.actorUpsert({ sessionID: session.id, name: "Bob" })
        const requestID = "question_vote_1"

        const events: Doc.SubmitEvent[] = []
        const stop = Doc.questionSubmitConnect({
          sessionID: session.id,
          requestID,
          actorID: bob.actorID,
          peer: { send: (data) => events.push(JSON.parse(data) as Doc.SubmitEvent) },
        })

        const state = Doc.questionSubmitCreate({
          sessionID: session.id,
          requestID,
          actorID: alice.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          payload: { requestID, answers: [["B"]] },
        })
        expect(state.status).toBe("pending")
        expect(state.targetKind).toBe("question")
        expect(state.targetID).toBe(requestID)
        expect(events[0]?.type).toBe("created")

        // Concurrent create on the same request returns the same in-flight vote (pending-unique).
        const again = Doc.questionSubmitCreate({
          sessionID: session.id,
          requestID,
          actorID: bob.actorID,
          actorIDs: [alice.actorID, bob.actorID],
          payload: { requestID, answers: [["B"]] },
        })
        expect(again.submitID).toBe(state.submitID)

        // Bob approves → all approved → sent (send() calls Question.reply; no pending request just warns).
        const sent = Doc.submitRespond({
          sessionID: session.id,
          submitID: state.submitID,
          actorID: bob.actorID,
          action: "approve",
        })
        expect(sent.status).toBe("sent")
        expect(events.at(-1)?.type).toBe("sent")

        stop()
      },
    })
  })
})
