import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { ReproductionSteps } from "../../src/debug/repro"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("ReproductionSteps", () => {
  test("ask publishes event and resolves on reply", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asked = new Promise<ReproductionSteps.Request>((resolve) => {
          const unsubscribe = Bus.subscribe(ReproductionSteps.Event.Asked, (event) => {
            unsubscribe()
            resolve(event.properties)
          })
        })

        const actionPromise = ReproductionSteps.ask({
          sessionID: "ses_repro_1",
          steps: ["Open the app", "Click the button"],
        })

        const request = await asked
        expect(request.steps).toEqual(["Open the app", "Click the button"])
        expect(request.sessionID).toBe("ses_repro_1")

        await ReproductionSteps.reply({ requestID: request.id, action: "proceed" })
        await expect(actionPromise).resolves.toBe("proceed")

        const pending = await ReproductionSteps.list()
        expect(pending.length).toBe(0)
      },
    })
  })

  test("list returns pending requests", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asked = new Promise<ReproductionSteps.Request>((resolve) => {
          const unsubscribe = Bus.subscribe(ReproductionSteps.Event.Asked, (event) => {
            unsubscribe()
            resolve(event.properties)
          })
        })

        const actionPromise = ReproductionSteps.ask({
          sessionID: "ses_repro_2",
          steps: ["Step one"],
        })

        const request = await asked
        const pending = await ReproductionSteps.list()
        expect(pending.map((item) => item.id)).toContain(request.id)

        await ReproductionSteps.reply({ requestID: request.id, action: "fixed" })
        await expect(actionPromise).resolves.toBe("fixed")
      },
    })
  })

  test("reject rejects pending request with RejectedError", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const asked = new Promise<ReproductionSteps.Request>((resolve) => {
          const unsubscribe = Bus.subscribe(ReproductionSteps.Event.Asked, (event) => {
            unsubscribe()
            resolve(event.properties)
          })
        })

        const actionPromise = ReproductionSteps.ask({
          sessionID: "ses_repro_3",
          steps: ["Step one"],
        })

        const request = await asked
        await ReproductionSteps.reject(request.id)

        await expect(actionPromise).rejects.toBeInstanceOf(ReproductionSteps.RejectedError)

        const pending = await ReproductionSteps.list()
        expect(pending.length).toBe(0)
      },
    })
  })
})
