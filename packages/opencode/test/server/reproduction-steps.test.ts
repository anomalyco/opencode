import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { ReproductionSteps } from "../../src/debug/repro"
import { Bus } from "../../src/bus"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("reproduction-steps routes", () => {
  test("list returns pending requests", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path

    await Instance.provide({
      directory: worktreeRoot,
      fn: async () => {
        const app = Server.App()
        const asked = new Promise<ReproductionSteps.Request>((resolve) => {
          const unsubscribe = Bus.subscribe(ReproductionSteps.Event.Asked, (event) => {
            unsubscribe()
            resolve(event.properties)
          })
        })

        const actionPromise = ReproductionSteps.ask({
          sessionID: "ses_repro_list_1",
          steps: ["Open the app"],
        })

        const request = await asked
        const response = await app.request(`/reproduction-steps?directory=${encodeURIComponent(worktreeRoot)}`)
        expect(response.status).toBe(200)

        const body = (await response.json()) as ReproductionSteps.Request[]
        expect(body.map((item) => item.id)).toContain(request.id)

        const reply = await app.request(
          `/reproduction-steps/${request.id}/reply?directory=${encodeURIComponent(worktreeRoot)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "proceed" }),
          },
        )
        expect(reply.status).toBe(200)
        await expect(actionPromise).resolves.toBe("proceed")
      },
    })
  })

  test("reply resolves pending request", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path

    await Instance.provide({
      directory: worktreeRoot,
      fn: async () => {
        const app = Server.App()
        const asked = new Promise<ReproductionSteps.Request>((resolve) => {
          const unsubscribe = Bus.subscribe(ReproductionSteps.Event.Asked, (event) => {
            unsubscribe()
            resolve(event.properties)
          })
        })

        const actionPromise = ReproductionSteps.ask({
          sessionID: "ses_repro_reply_1",
          steps: ["Click the button"],
        })

        const request = await asked
        const response = await app.request(
          `/reproduction-steps/${request.id}/reply?directory=${encodeURIComponent(worktreeRoot)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "fixed" }),
          },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        await expect(actionPromise).resolves.toBe("fixed")
      },
    })
  })

  test("reject rejects pending request", async () => {
    await using tmp = await tmpdir({ git: true })
    const worktreeRoot = tmp.path

    await Instance.provide({
      directory: worktreeRoot,
      fn: async () => {
        const app = Server.App()
        const asked = new Promise<ReproductionSteps.Request>((resolve) => {
          const unsubscribe = Bus.subscribe(ReproductionSteps.Event.Asked, (event) => {
            unsubscribe()
            resolve(event.properties)
          })
        })

        const actionPromise = ReproductionSteps.ask({
          sessionID: "ses_repro_reject_1",
          steps: ["Attempt reproduction"],
        })

        const request = await asked
        const response = await app.request(
          `/reproduction-steps/${request.id}/reject?directory=${encodeURIComponent(worktreeRoot)}`,
          {
            method: "POST",
          },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toBe(true)
        await expect(actionPromise).rejects.toBeInstanceOf(ReproductionSteps.RejectedError)
      },
    })
  })
})
