import { expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client/promise"
import { activeProviderAccount, providerAccounts } from "./accounts"

const integration = (connections: IntegrationInfo["connections"]): IntegrationInfo => ({
  id: "openai",
  name: "OpenAI",
  methods: [],
  connections,
})

test("provider accounts keep the server's active-first credential order and ignore environment keys", () => {
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

  const env = integration([{ type: "env", name: "OPENAI_API_KEY" }])
  expect(providerAccounts(env)).toEqual([])
  expect(activeProviderAccount(env)).toBeUndefined()
  expect(providerAccounts(undefined)).toEqual([])
})
