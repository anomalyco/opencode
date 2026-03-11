import { test, expect, mock } from "bun:test"
import { ShareNext } from "../../src/share/share-next"
import { AccessToken, Account, AccountID, OrgID } from "../../src/account"
import { Config } from "../../src/config/config"

test("ShareNext.request uses legacy share API without active org account", async () => {
  const originalActive = Account.active
  const originalConfigGet = Config.get

  Account.active = mock(() => undefined)
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
    Account.active = originalActive
    Config.get = originalConfigGet
  }
})

test("ShareNext.request uses org share API with auth headers when account is active", async () => {
  const originalActive = Account.active
  const originalToken = Account.token

  Account.active = mock(() => ({
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
    Account.active = originalActive
    Account.token = originalToken
  }
})

test("ShareNext.request fails when org account has no token", async () => {
  const originalActive = Account.active
  const originalToken = Account.token

  Account.active = mock(() => ({
    id: AccountID.make("account-1"),
    email: "user@example.com",
    url: "https://control.example.com",
    active_org_id: OrgID.make("org-1"),
  }))
  Account.token = mock(async () => undefined)

  try {
    await expect(ShareNext.request()).rejects.toThrow("No active account token available for sharing")
  } finally {
    Account.active = originalActive
    Account.token = originalToken
  }
})
