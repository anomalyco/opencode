import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.started event", () => {
  test("should emit session.started event when session is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        let eventReceived = false
        let receivedInfo: Session.Info | undefined

        const unsub = Bus.subscribe(Session.Event.Created, (event) => {
          eventReceived = true
          receivedInfo = event.properties.info as Session.Info
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsub()

        expect(eventReceived).toBe(true)
        expect(receivedInfo).toBeDefined()
        expect(receivedInfo?.id).toBe(session.id)
        expect(receivedInfo?.projectID).toBe(session.projectID)
        expect(receivedInfo?.directory).toBe(session.directory)
        expect(receivedInfo?.title).toBe(session.title)

        await Session.remove(session.id)
      },
    })
  })

  test("session.started event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubStarted = Bus.subscribe(Session.Event.Created, () => {
          events.push("started")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubStarted()
        unsubUpdated()

        expect(events).toContain("started")
        expect(events).toContain("updated")
        expect(events.indexOf("started")).toBeLessThan(events.indexOf("updated"))

        await Session.remove(session.id)
      },
    })
  })
})

describe("session creation with parent/child relationship", () => {
  let parentSession: Session.Info | null = null
  let childSession: Session.Info | null = null

  afterEach(async () => {
    if (childSession) {
      await Session.remove(childSession.id).catch(() => {})
      childSession = null
    }
    if (parentSession) {
      await Session.remove(parentSession.id).catch(() => {})
      parentSession = null
    }
  })

  test("should create parent session with default title", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        parentSession = await Session.create({})
        expect(parentSession).toBeDefined()
        expect(parentSession!.title).toStartWith("New session - ")
        expect(parentSession!.parentID).toBeUndefined()
        expect(parentSession!.childrenIDs).toEqual([])
      },
    })
  })

  test("should create child session with parentID set and child title", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        parentSession = await Session.create({})
        childSession = await Session.create({ parentID: parentSession!.id })

        expect(childSession).toBeDefined()
        expect(childSession!.parentID).toBe(parentSession!.id)
        expect(childSession!.title).toStartWith("Child session - ")
      },
    })
  })

  test("should populate childrenIDs on parent when child is created", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        parentSession = await Session.create({})
        childSession = await Session.create({ parentID: parentSession!.id })

        const updatedParent = await Session.get(parentSession!.id)
        expect(updatedParent.childrenIDs).toBeDefined()
        expect(updatedParent.childrenIDs).toContain(childSession!.id)
        expect(updatedParent.childrenIDs!.length).toBe(1)
      },
    })
  })

  test("should add multiple children to parent childrenIDs", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        parentSession = await Session.create({})
        const child1 = await Session.create({ parentID: parentSession!.id })
        const child2 = await Session.create({ parentID: parentSession!.id })
        const child3 = await Session.create({ parentID: parentSession!.id })

        const updatedParent = await Session.get(parentSession!.id)
        expect(updatedParent.childrenIDs).toBeDefined()
        expect(updatedParent.childrenIDs!.length).toBe(3)
        expect(updatedParent.childrenIDs).toContain(child1.id)
        expect(updatedParent.childrenIDs).toContain(child2.id)
        expect(updatedParent.childrenIDs).toContain(child3.id)
      },
    })
  })
})

describe("Session.children function", () => {
  let parentSession: Session.Info | null = null
  let children: Session.Info[] = []

  afterEach(async () => {
    for (const child of children) {
      await Session.remove(child.id).catch(() => {})
    }
    children = []
    if (parentSession) {
      await Session.remove(parentSession.id).catch(() => {})
      parentSession = null
    }
  })

  test("children should return empty array when no children exist", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        parentSession = await Session.create({})
        const result = await Session.children(parentSession!.id)
        expect(result).toEqual([])
      },
    })
  })

  test("children should return children using fast path (childrenIDs)", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        parentSession = await Session.create({})
        const child1 = await Session.create({ parentID: parentSession!.id })
        const child2 = await Session.create({ parentID: parentSession!.id })
        children = [child1, child2]

        const result = await Session.children(parentSession!.id)
        expect(result.length).toBe(2)
        const childIds = result.map((c) => c.id).sort()
        expect(childIds).toEqual([child1.id, child2.id].sort())
      },
    })
  })

  test("children should filter out null sessions when child is missing", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        parentSession = await Session.create({})
        const child1 = await Session.create({ parentID: parentSession!.id })
        children = [child1]

        const nonexistentID = Identifier.descending("session")
        await Session.update(parentSession!.id, (draft) => {
          draft.childrenIDs = [child1.id, nonexistentID]
        })

        const result = await Session.children(parentSession!.id)
        expect(result.length).toBe(1)
        expect(result[0].id).toBe(child1.id)
      },
    })
  })

  test("children should use fallback when childrenIDs is not set", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        parentSession = await Session.create({})
        const child1 = await Session.create({ parentID: parentSession!.id })
        const child2 = await Session.create({ parentID: parentSession!.id })
        children = [child1, child2]

        await Session.update(parentSession!.id, (draft) => {
          draft.childrenIDs = undefined
        })

        const result = await Session.children(parentSession!.id)
        expect(result.length).toBe(2)
      },
    })
  })
})

describe("Session.remove with children", () => {
  test("should recursively remove all children when removing parent", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const parent = await Session.create({})
        const child1 = await Session.create({ parentID: parent.id })
        const child2 = await Session.create({ parentID: parent.id })
        const grandchild = await Session.create({ parentID: child1.id })

        await Session.remove(parent.id)

        const parentAfter = await Session.get(parent.id).catch(() => null)
        const child1After = await Session.get(child1.id).catch(() => null)
        const child2After = await Session.get(child2.id).catch(() => null)
        const grandchildAfter = await Session.get(grandchild.id).catch(() => null)

        expect(parentAfter).toBeNull()
        expect(child1After).toBeNull()
        expect(child2After).toBeNull()
        expect(grandchildAfter).toBeNull()
      },
    })
  })

  test("children function should not return removed children", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const parent = await Session.create({})
        const child1 = await Session.create({ parentID: parent.id })
        const child2 = await Session.create({ parentID: parent.id })

        await Session.remove(child1.id)

        const children = await Session.children(parent.id)
        expect(children.length).toBe(1)
        expect(children[0].id).toBe(child2.id)

        await Session.remove(parent.id)
      },
    })
  })
})
