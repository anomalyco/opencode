import { describe, expect, test } from "bun:test"
import path from "path"
import { Session as SessionNs } from "@/session/session"
import { Bus } from "../../src/bus"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { WithInstance } from "../../src/project/with-instance"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { AppRuntime } from "../../src/effect/app-runtime"
import { tmpdir } from "../fixture/fixture"

const projectRoot = path.join(__dirname, "../..")
void Log.init({ print: false })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function timeout<T>(promise: Promise<T>, message: string) {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), 2_000))])
}

function create(input?: SessionNs.CreateInput) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create(input)))
}

function get(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.get(id)))
}

function remove(id: SessionID) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.remove(id)))
}

function updateMessage<T extends MessageV2.Info>(msg: T) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.updateMessage(msg)))
}

function updatePart<T extends MessageV2.Part>(part: T) {
  return AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.updatePart(part)))
}

describe("session.created event", () => {
  test("should emit session.created event when session is created", async () => {
    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const received = deferred<SessionNs.Info>()

        const unsub = Bus.subscribe(SessionNs.Event.Created, (event) => {
          received.resolve(event.properties.info as SessionNs.Info)
        })

        const info = await create({})
        const receivedInfo = await timeout(received.promise, "timed out waiting for session.created")
        unsub()

        expect(receivedInfo.id).toBe(info.id)
        expect(receivedInfo.projectID).toBe(info.projectID)
        expect(receivedInfo.directory).toBe(info.directory)
        expect(receivedInfo.path).toBe(info.path)
        expect(receivedInfo.title).toBe(info.title)

        await remove(info.id)
      },
    })
  })

  test("session.created event should be emitted before session.updated", async () => {
    if (Flag.OPENCODE_EXPERIMENTAL_WORKSPACES) return

    await WithInstance.provide({
      directory: projectRoot,
      fn: async () => {
        const events: string[] = []
        const received = deferred<string[]>()
        const push = (event: string) => {
          events.push(event)
          if (events.includes("created") && events.includes("updated")) received.resolve(events)
        }

        const unsubCreated = Bus.subscribe(SessionNs.Event.Created, () => {
          push("created")
        })

        const unsubUpdated = Bus.subscribe(SessionNs.Event.Updated, () => {
          push("updated")
        })

        const info = await create({})
        const receivedEvents = await timeout(received.promise, "timed out waiting for session created/updated events")
        unsubCreated()
        unsubUpdated()

        expect(receivedEvents).toContain("created")
        expect(receivedEvents).toContain("updated")
        expect(receivedEvents.indexOf("created")).toBeLessThan(receivedEvents.indexOf("updated"))

        await remove(info.id)
      },
    })
  })
})

describe("step-finish token propagation via Bus event", () => {
  test(
    "non-zero tokens propagate through PartUpdated event",
    async () => {
      await WithInstance.provide({
        directory: projectRoot,
        fn: async () => {
          const info = await create({})

          const messageID = MessageID.ascending()
          await updateMessage({
            id: messageID,
            sessionID: info.id,
            role: "user",
            time: { created: Date.now() },
            agent: "user",
            model: { providerID: "test", modelID: "test" },
            tools: {},
            mode: "",
          } as unknown as MessageV2.Info)

          // Bus subscribers receive readonly Schema.Type payloads; `MessageV2.Part`
          // is the mutable domain type. Cast bridges the two — safe because the
          // test only reads the value afterwards.
          const received = deferred<MessageV2.Part>()
          const unsub = Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
            received.resolve(event.properties.part as MessageV2.Part)
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
            sessionID: info.id,
            type: "step-finish" as const,
            reason: "stop",
            cost: 0.005,
            tokens,
          }

          await updatePart(partInput)
          const receivedPart = await timeout(received.promise, "timed out waiting for message.part.updated")

          expect(receivedPart.type).toBe("step-finish")
          const finish = receivedPart as MessageV2.StepFinishPart
          expect(finish.tokens.input).toBe(500)
          expect(finish.tokens.output).toBe(800)
          expect(finish.tokens.reasoning).toBe(200)
          expect(finish.tokens.total).toBe(1500)
          expect(finish.tokens.cache.read).toBe(100)
          expect(finish.tokens.cache.write).toBe(50)
          expect(finish.cost).toBe(0.005)
          expect(receivedPart).not.toBe(partInput)

          unsub()
          await remove(info.id)
        },
      })
    },
    { timeout: 30000 },
  )
})

describe("Session", () => {
  test("remove works without an instance", async () => {
    await using tmp = await tmpdir({ git: true })

    const info = await WithInstance.provide({
      directory: tmp.path,
      fn: () => create({ title: "remove-without-instance" }),
    })

    await expect(async () => {
      await remove(info.id)
    }).not.toThrow()

    let missing = false
    await get(info.id).catch(() => {
      missing = true
    })

    expect(missing).toBe(true)
  })
})
