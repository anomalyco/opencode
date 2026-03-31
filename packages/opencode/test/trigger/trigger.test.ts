import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { Trigger } from "../../src/trigger"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

describe("trigger service", () => {
  test("creates triggers per instance and fires them later", async () => {
    await using a = await tmpdir({ git: true })
    await using b = await tmpdir({ git: true })

    await Instance.provide({
      directory: a.path,
      fn: async () => {
        const item = await Trigger.create({ interval: 20 })
        const list = await Trigger.list()
        expect(list).toHaveLength(1)
        expect(list[0]).toMatchObject({
          id: item.id,
          schedule: { interval: 20 },
          enabled: true,
          runs: 0,
        })

        await Bun.sleep(80)

        const next = (await Trigger.list())[0]
        expect(next?.runs).toBeGreaterThan(0)
        expect(next?.time.last).toBeGreaterThanOrEqual(next!.time.created)
      },
    })

    await Instance.provide({
      directory: b.path,
      fn: async () => {
        expect(await Trigger.list()).toEqual([])
      },
    })
  })

  test("disabled trigger does not fire until re-enabled", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const item = await Trigger.create({ interval: 20 })

        expect((await Trigger.get(item.id)).enabled).toBe(true)

        const off = await Trigger.disable(item.id)
        expect(off.enabled).toBe(false)

        await Bun.sleep(80)

        const idle = await Trigger.get(item.id)
        expect(idle.enabled).toBe(false)
        expect(idle.runs).toBe(0)

        const on = await Trigger.enable(item.id)
        expect(on.enabled).toBe(true)

        await Bun.sleep(80)

        const next = await Trigger.get(item.id)
        expect(next.enabled).toBe(true)
        expect(next.runs).toBeGreaterThan(0)
      },
    })
  })

  test("deleted trigger no longer lists or fires", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const item = await Trigger.create({ interval: 20 })
        await Trigger.remove(item.id)

        expect(await Trigger.list()).toEqual([])

        await Bun.sleep(80)

        expect(await Trigger.list()).toEqual([])
      },
    })
  })

  test("fires command action for an idle session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const command = spyOn(SessionPrompt, "command").mockResolvedValue(
          {} as Awaited<ReturnType<typeof SessionPrompt.command>>,
        )

        await Trigger.create({
          interval: 20,
          action: {
            type: "command",
            sessionID: session.id,
            command: "init",
            arguments: "--help",
          },
        })

        await Bun.sleep(80)

        expect(command).toHaveBeenCalledWith({
          sessionID: session.id,
          command: "init",
          arguments: "--help",
        })
      },
    })
  })

  test("skips command action for a busy session", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const command = spyOn(SessionPrompt, "command").mockResolvedValue(
          {} as Awaited<ReturnType<typeof SessionPrompt.command>>,
        )
        await SessionStatus.set(session.id, { type: "busy" })

        await Trigger.create({
          interval: 20,
          action: {
            type: "command",
            sessionID: session.id,
            command: "init",
            arguments: "--help",
          },
        })

        await Bun.sleep(80)

        expect(command).not.toHaveBeenCalled()
      },
    })
  })
})
