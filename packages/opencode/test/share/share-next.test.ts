import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { AccessToken, Account, AccountID, OrgID } from "../../src/account"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"
import { ShareNext } from "../../src/share/share-next"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("ShareNext.request uses legacy share API without active org account", async () => {
  const active = Account.active
  const get = Config.get

  Account.active = mock(async () => undefined)
  Config.get = mock(async () => ({ enterprise: { url: "https://legacy-share.example.com" } }))

  try {
    const req = await ShareNext.request()

    expect(req.api.create).toBe("/api/share")
    expect(req.api.sync("shr_123")).toBe("/api/share/shr_123/sync")
    expect(req.api.remove("shr_123")).toBe("/api/share/shr_123")
    expect(req.api.data("shr_123")).toBe("/api/share/shr_123/data")
    expect(req.baseUrl).toBe("https://legacy-share.example.com")
    expect(req.headers).toEqual({})
  } finally {
    Account.active = active
    Config.get = get
  }
})

test("ShareNext.request uses org share API with auth headers when account is active", async () => {
  const active = Account.active
  const token = Account.token

  Account.active = mock(async () => ({
    id: AccountID.make("account-1"),
    email: "user@example.com",
    url: "https://control.example.com",
    active_org_id: OrgID.make("org-1"),
  }))
  Account.token = mock(async () => AccessToken.make("st_test_token"))

  try {
    const req = await ShareNext.request()

    expect(req.api.create).toBe("/api/shares")
    expect(req.api.sync("shr_123")).toBe("/api/shares/shr_123/sync")
    expect(req.api.remove("shr_123")).toBe("/api/shares/shr_123")
    expect(req.api.data("shr_123")).toBe("/api/shares/shr_123/data")
    expect(req.baseUrl).toBe("https://control.example.com")
    expect(req.headers).toEqual({
      authorization: "Bearer st_test_token",
      "x-org-id": "org-1",
    })
  } finally {
    Account.active = active
    Account.token = token
  }
})

test("ShareNext.request fails when org account has no token", async () => {
  const active = Account.active
  const token = Account.token

  Account.active = mock(async () => ({
    id: AccountID.make("account-1"),
    email: "user@example.com",
    url: "https://control.example.com",
    active_org_id: OrgID.make("org-1"),
  }))
  Account.token = mock(async () => undefined)

  try {
    await expect(ShareNext.request()).rejects.toThrow("No active account token available for sharing")
  } finally {
    Account.active = active
    Account.token = token
  }
})

test("ShareNext.init unsubscribes bus listeners on instance disposal", async () => {
  await using tmp = await tmpdir()
  const unsub = mock(() => {})
  const sub = spyOn(Bus, "subscribe").mockImplementation(() => unsub)

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ShareNext.init()
      },
    })

    expect(sub).toHaveBeenCalledTimes(4)
    expect(unsub).toHaveBeenCalledTimes(0)

    await Instance.disposeAll()

    expect(unsub).toHaveBeenCalledTimes(4)
  } finally {
    sub.mockRestore()
  }
})

test("ShareNext user-message callback keeps instance context for provider lookups", async () => {
  await using tmp = await tmpdir()
  const seen: string[] = []
  const get = Provider.getModel
  const spy = spyOn(Provider, "getModel").mockImplementation(async (...args) => {
    seen.push("entered")
    await Config.get()
    seen.push("ctx")
    return get(...args)
  })

  try {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ShareNext.init()
        const provider = Object.values(await Provider.list())[0]
        if (!provider) throw new Error("expected at least one provider")
        const model = Object.values(provider.models)[0]
        if (!model) throw new Error("expected at least one model")
        const session = await Session.create({})

        await Session.updateMessage({
          id: MessageID.ascending(),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "test",
          model: { providerID: model.providerID, modelID: model.id },
          tools: {},
          mode: "",
        } as unknown as MessageV2.Info)
        await Bun.sleep(25)
        await Session.remove(session.id)
        await Bun.sleep(1100)
      },
    })

    expect(spy).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(["entered", "ctx"])
  } finally {
    spy.mockRestore()
  }
})
