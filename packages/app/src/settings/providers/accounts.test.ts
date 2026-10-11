import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client/promise"
import { activeProviderAccount, providerAccounts } from "./accounts"

const integration = (connections: IntegrationInfo["connections"]): IntegrationInfo => ({
  id: Integration.ID.make("openai", { disableChecks: true }),
  name: "OpenAI",
  methods: [],
  connections,
})

test("provider accounts keep the server's active-first credential order and ignore environment keys", () => {
  const value = integration([
    { type: "credential", id: Credential.ID.make("cred_work", { disableChecks: true }), label: "Work", method: "key" },
    { type: "env", name: "OPENAI_API_KEY" },
    {
      type: "credential",
      id: Credential.ID.make("cred_personal", { disableChecks: true }),
      label: "Personal",
      method: "oauth",
    },
  ])

  expect<unknown>(providerAccounts(value)).toEqual([
    { type: "credential", id: "cred_work", label: "Work", method: "key" },
    {
      type: "credential",
      id: "cred_personal",
      label: "Personal",
      method: "oauth",
    },
  ])
  expect<unknown>(activeProviderAccount(value)).toEqual({
    type: "credential",
    id: "cred_work",
    label: "Work",
    method: "key",
  })

  const env = integration([{ type: "env", name: "OPENAI_API_KEY" }])
  expect(providerAccounts(env)).toEqual([])
  expect(activeProviderAccount(env)).toBeUndefined()
  expect(providerAccounts(undefined)).toEqual([])
})
