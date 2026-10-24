import { expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode/client/promise"
import { activeProviderAccount, connectPickerIntegrations, providerAccounts } from "./accounts"

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

test("the connect picker folds OpenCode Go into the OpenCode row unless a Go API key is saved", () => {
  const go = (connections: IntegrationInfo["connections"]): IntegrationInfo => ({
    id: "opencode-go",
    name: "OpenCode Go",
    methods: [{ type: "key" }],
    connections,
  })
  const opencode: IntegrationInfo = { id: "opencode", name: "OpenCode Console", methods: [], connections: [] }

  expect(connectPickerIntegrations([go([]), opencode]).map((item) => item.id)).toEqual(["opencode"])
  expect(
    connectPickerIntegrations([go([{ type: "env", name: "OPENCODE_API_KEY" }]), opencode]).map((item) => item.id),
  ).toEqual(["opencode"])
  expect(
    connectPickerIntegrations([
      go([{ type: "credential", id: "cred_go", label: "Go key", method: "key" }]),
      opencode,
    ]).map((item) => item.id),
  ).toEqual(["opencode-go", "opencode"])
})
