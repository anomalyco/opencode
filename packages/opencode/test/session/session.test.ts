import { describe, expect, test } from "bun:test"
import path from "path"
import { Session } from "../../src/session"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session.created event", () => {
  test("should emit session.created event when session is created", async () => {
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

  test("session.created event should be emitted before session.updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []

        const unsubCreated = Bus.subscribe(Session.Event.Created, () => {
          events.push("created")
        })

        const unsubUpdated = Bus.subscribe(Session.Event.Updated, () => {
          events.push("updated")
        })

        const session = await Session.create({})

        await new Promise((resolve) => setTimeout(resolve, 100))

        unsubCreated()
        unsubUpdated()

        expect(events).toContain("created")
        expect(events).toContain("updated")
        expect(events.indexOf("created")).toBeLessThan(events.indexOf("updated"))

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

          const messageID = MessageID.ascending()
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
            id: PartID.ascending(),
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

describe("session model", () => {
  test("new session has no model by default", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        expect(session.model).toBeUndefined()
        await Session.remove(session.id)
      },
    })
  })

  test("setModel updates session model", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        await Session.setModel({
          sessionID: session.id,
          model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
        })

        const updated = await Session.get(session.id)
        expect(updated.model).toEqual({ providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") })

        await Session.remove(session.id)
      },
    })
  })

  test("setModel with undefined clears model", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})

        await Session.setModel({
          sessionID: session.id,
          model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-4") },
        })

        await Session.setModel({
          sessionID: session.id,
          model: undefined,
        })

        const updated = await Session.get(session.id)
        expect(updated.model).toBeUndefined()

        await Session.remove(session.id)
      },
    })
  })

  test("list includes model info", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session1 = await Session.create({})
        const session2 = await Session.create({})

        await Session.setModel({
          sessionID: session1.id,
          model: { providerID: ProviderID.make("anthropic"), modelID: ModelID.make("claude-sonnet-4-20250514") },
        })

        const sessions = [...Session.list({ roots: true })]
        const found = sessions.find((s) => s.id === session1.id)
        expect(found?.model).toEqual({
          providerID: ProviderID.make("anthropic"),
          modelID: ModelID.make("claude-sonnet-4-20250514"),
        })

        const withoutModel = sessions.find((s) => s.id === session2.id)
        expect(withoutModel?.model).toBeUndefined()

        await Session.remove(session1.id)
        await Session.remove(session2.id)
      },
    })
  })
})
