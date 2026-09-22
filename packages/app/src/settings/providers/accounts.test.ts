import { describe, expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client/promise"
import { activeProviderAccount, providerAccounts } from "./accounts"

const integration = (connections: IntegrationInfo["connections"]): IntegrationInfo => ({
  id: "openai",
  name: "OpenAI",
  methods: [],
  connections,
})

describe("provider accounts", () => {
  test("preserves the server's active-first credential order", () => {
    const value = integration([
      { type: "credential", id: "cred_work", label: "Work", method: "key" },
      { type: "env", name: "OPENAI_API_KEY" },
      { type: "credential", id: "cred_personal", label: "Personal", method: "oauth" },
    ])

    expect(providerAccounts(value)).toEqual([
      { type: "credential", id: "cred_work", label: "Work", method: "key" },
      { type: "credential", id: "cred_personal", label: "Personal", method: "oauth" },
    ])
    expect(activeProviderAccount(value)).toEqual({ type: "credential", id: "cred_work", label: "Work", method: "key" })
  })

  test("returns no active account for environment-only integrations", () => {
    const value = integration([{ type: "env", name: "OPENAI_API_KEY" }])

    expect(providerAccounts(value)).toEqual([])
    expect(activeProviderAccount(value)).toBeUndefined()
    expect(providerAccounts(undefined)).toEqual([])
  })
})
