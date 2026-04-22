import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { BugReportTranslate } from "../../src/team/bug-report-translate"
import { MainPlanTranslate } from "../../src/team/main-plan-translate"
import { MemoryTranslate } from "../../src/team/memory-translate"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

describe("translation routes", () => {
  test("memory translate route queues work without waiting", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(MemoryTranslate, "translate").mockResolvedValue(3)

    const res = await Server.Default().app.request("/project/current/memory/translate", {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 3 })
    expect(spy).toHaveBeenCalledWith({ all: true })
  })

  test("bug report translate route queues work without waiting", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(BugReportTranslate, "translate").mockResolvedValue(2)

    const res = await Server.Default().app.request("/bug-report/translate", {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 2 })
    expect(spy).toHaveBeenCalledWith({ all: true })
  })

  test("main plan translate route queues work without waiting", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(MainPlanTranslate, "translate").mockResolvedValue(1)

    const res = await Server.Default().app.request("/main-plan/translate", {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    expect(spy).toHaveBeenCalledWith({ all: true })
  })
})
