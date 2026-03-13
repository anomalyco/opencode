import { afterEach, expect, test } from "bun:test"
import { Auth } from "../../src/auth"
import { ProviderAuth } from "../../src/provider/auth"
import { ProviderID } from "../../src/provider/schema"

afterEach(async () => {
  await Auth.remove("test-provider-auth")
})

test("ProviderAuth.api persists auth via AuthService", async () => {
  await ProviderAuth.api({
    providerID: ProviderID.make("test-provider-auth"),
    key: "sk-test",
  })

  expect(await Auth.get("test-provider-auth")).toEqual({
    type: "api",
    key: "sk-test",
  })
})
