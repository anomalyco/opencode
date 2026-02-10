import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
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

describe("step-finish token propagation via Bus event", () => {
  test(
    "non-zero tokens propagate through PartUpdated event",
    async () => {
      await Instance.provide({
        directory: projectRoot,
        fn: async () => {
          const session = await Session.create({})

          const messageID = Identifier.ascending("message")
          await Session.updateMessage({
            id: messageID,
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: "user",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "",
          } as unknown as MessageV2.Info)

          let received: MessageV2.Part | undefined
          const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
            received = event.properties.part
          })

          const tokens = {
            total: 1500,
            input: 500,
            output: 800,
            reasoning: 200,
            cache: { read: 100, write: 50 },
          }

          const partInput = {
            id: Identifier.ascending("part"),
            messageID,
            sessionID: session.id,
            type: "step-finish" as const,
            reason: "stop",
            cost: 0.005,
            tokens,
          }

          await Session.updatePart(partInput)

          await new Promise((resolve) => setTimeout(resolve, 100))

          expect(received).toBeDefined()
          expect(received!.type).toBe("step-finish")
          const finish = received as MessageV2.StepFinishPart
          expect(finish.tokens.input).toBe(500)
          expect(finish.tokens.output).toBe(800)
          expect(finish.tokens.reasoning).toBe(200)
          expect(finish.tokens.total).toBe(1500)
          expect(finish.tokens.cache.read).toBe(100)
          expect(finish.tokens.cache.write).toBe(50)
          expect(finish.cost).toBe(0.005)
          expect(received).not.toBe(partInput)

          unsub()
          await Session.remove(session.id)
        },
      })
    },
    { timeout: 30000 },
  )
})

describe("session.create custom id", () => {
  test("custom ID accepted", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const customId = Identifier.descending("session")
        const session = await Session.create({ id: customId })

        expect(session.id).toBe(customId)

        await Session.remove(session.id)
      },
    })
  })

  test("default behavior preserved", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        expect(session.id).toMatch(/^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/)

        await Session.remove(session.id)
      },
    })
  })

  test("duplicate ID returns error", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const customId = Identifier.descending("session")
        const session = await Session.create({ id: customId })

        await expect(Session.create({ id: customId })).rejects.toThrow("DuplicateIDError")

        await Session.remove(session.id)
      },
    })
  })

  test("invalid prefix rejected", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        expect(() => Session.create({ id: "bad_a1b2c3d4e5f6AbCdEfGhIjKlMn" })).toThrow()
      },
    })
  })
})
