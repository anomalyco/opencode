import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Browser } from "../../src/browser"
import { BrowserRoutes } from "../../src/server/routes/browser"
import { SessionID } from "../../src/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { WithInstance } from "../../src/project/with-instance"
import { Session as SessionNs } from "@/session/session"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { AppRuntime } from "@/effect/app-runtime"

void Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await disposeAllInstances()
})

const id = SessionID.make("ses_12345678901234567890123456")

const info = {
  sessionID: id,
  profile: `/tmp/${id}`,
  enabled: true,
}

describe("browser routes", () => {
  test("tabs all route checks each session", async () => {
    await using dir = await tmpdir({ git: true })
    const tabs = spyOn(Browser, "tabs").mockImplementation(async (sessionID) => ({ sessionID, tabs: [] }))
    const app = BrowserRoutes()

    const result = await WithInstance.provide({
      directory: dir.path,
      fn: async () => {
        const root = await AppRuntime.runPromise(SessionNs.Service.use((svc) => svc.create({ title: "root" })))
        const child = await AppRuntime.runPromise(
          SessionNs.Service.use((svc) => svc.create({ title: "child", parentID: root.id })),
        )
        const res = await app.request(`/${root.id}/tabs/all`)
        return { child, res, root }
      },
    })

    expect(result.res.status).toBe(200)
    expect(tabs).toHaveBeenCalledWith(result.root.id)
    expect(tabs).toHaveBeenCalledWith(result.child.id)
  })

  test("open route calls Browser.open", async () => {
    const open = spyOn(Browser, "open").mockResolvedValue(info)
    const app = BrowserRoutes()

    const res = await app.request(`/${id}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    })

    expect(res.status).toBe(200)
    expect(open).toHaveBeenCalledWith({
      sessionID: id,
      url: "https://example.com",
    })
  })

  test("action route calls Browser.action", async () => {
    const action = spyOn(Browser, "action").mockResolvedValue(info)
    const app = BrowserRoutes()

    const res = await app.request(`/${id}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reload" }),
    })

    expect(res.status).toBe(200)
    expect(action).toHaveBeenCalledWith({
      sessionID: id,
      action: "reload",
    })
  })
})
