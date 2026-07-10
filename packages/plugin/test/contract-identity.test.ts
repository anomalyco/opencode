import { expect, test } from "bun:test"
import { Agent } from "@opencode-ai/schema/agent"
import { Command } from "@opencode-ai/schema/command"
import { Connection } from "@opencode-ai/schema/connection"
import { Credential } from "@opencode-ai/schema/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { Reference } from "@opencode-ai/schema/reference"
import { Skill } from "@opencode-ai/schema/skill"

const Plugin = await import("../src/v2/effect/index")
const PromisePlugin = await import("../src/v2/promise/index")

test.each([
  ["effect", Plugin],
  ["promise", PromisePlugin],
])("%s entrypoint exposes its canonical Schema contracts", (name, entrypoint) => {
  expect(entrypoint.Agent).toBe(Agent)
  expect(entrypoint.Command).toBe(Command)
  expect(entrypoint.Connection).toBe(Connection)
  expect(entrypoint.Credential).toBe(Credential)
  expect(entrypoint.Integration).toBe(Integration)
  expect(entrypoint.Model).toBe(Model)
  expect(entrypoint.Provider).toBe(Provider)
  expect(entrypoint.Reference).toBe(Reference)
  expect(entrypoint.Skill).toBe(Skill)
  expect(Object.keys(entrypoint).sort()).toEqual([
    "Agent",
    "Command",
    "Connection",
    "Credential",
    "Integration",
    "Model",
    "Plugin",
    "Provider",
    "Reference",
    "Skill",
  ])
})
