import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Browser } from "../../src/browser"
import { BrowserRoutes } from "../../src/server/routes/browser"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(() => {
  mock.restore()
})

const id = SessionID.make("ses_12345678901234567890123456")

const info = {
  sessionID: id,
  profile: `/tmp/${id}`,
  enabled: true,
}

describe("browser routes", () => {
  test("tabs all route checks each session", async () => {
    const child = SessionID.make("ses_22345678901234567890123456")
    const tabs = spyOn(Browser, "tabs").mockImplementation(async (sessionID) => ({ sessionID, tabs: [] }))
    spyOn(Session, "descendants").mockResolvedValue([{ id: child }] as Awaited<ReturnType<typeof Session.descendants>>)
    const app = BrowserRoutes()

    const res = await app.request(`/${id}/tabs/all`)

    expect(res.status).toBe(200)
    expect(tabs).toHaveBeenCalledWith(id)
    expect(tabs).toHaveBeenCalledWith(child)
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
