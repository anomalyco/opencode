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

  test("memory translate route forwards force requests", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(MemoryTranslate, "translate").mockResolvedValue(3)

    const res = await Server.Default().app.request("/project/current/memory/translate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({ force: true }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 3 })
    expect(spy).toHaveBeenCalledWith({ all: true, force: true })
  })

  test("memory translate stop route stops active work", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(MemoryTranslate, "stop").mockResolvedValue(2)

    const res = await Server.Default().app.request("/project/current/memory/translate/stop", {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 2 })
    expect(spy).toHaveBeenCalledTimes(1)
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

  test("bug report translate route forwards force requests", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(BugReportTranslate, "translate").mockResolvedValue(2)

    const res = await Server.Default().app.request("/bug-report/translate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({ force: true }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 2 })
    expect(spy).toHaveBeenCalledWith({ all: true, force: true })
  })

  test("bug report translate stop route stops active work", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(BugReportTranslate, "stop").mockResolvedValue(1)

    const res = await Server.Default().app.request("/bug-report/translate/stop", {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    expect(spy).toHaveBeenCalledTimes(1)
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

  test("main plan translate route forwards force requests", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(MainPlanTranslate, "translate").mockResolvedValue(1)

    const res = await Server.Default().app.request("/main-plan/translate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencode-directory": tmp.path,
      },
      body: JSON.stringify({ force: true }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    expect(spy).toHaveBeenCalledWith({ all: true, force: true })
  })

  test("main plan translate stop route stops active work", async () => {
    await using tmp = await tmpdir({ git: true })
    const spy = spyOn(MainPlanTranslate, "stop").mockResolvedValue(1)

    const res = await Server.Default().app.request("/main-plan/translate/stop", {
      method: "POST",
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 1 })
    expect(spy).toHaveBeenCalledTimes(1)
  })
})
