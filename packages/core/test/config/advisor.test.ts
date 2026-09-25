import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigAgent } from "../../src/config/agent"
import { ConfigAgentV1 } from "../../src/v1/config/agent"
import { ConfigMigrateV1 } from "../../src/v1/config/migrate"
import { ConfigAdvisor } from "../../src/config/advisor"

const settings = { model: "claude-opus-4-6", maxUses: 3 }

describe("advisor config", () => {
  test("validates complete settings only after layering", () => {
    expect(ConfigAdvisor.resolve(ConfigAdvisor.merge({ model: settings.model }, { maxUses: 3 }))).toEqual(settings)
    expect(ConfigAdvisor.resolve(false)).toBeUndefined()
    expect(ConfigAdvisor.resolve(undefined)).toBeUndefined()
    expect(() => ConfigAdvisor.resolve({ model: settings.model })).toThrow()
    expect(() => ConfigAdvisor.resolve(ConfigAdvisor.merge(false, { maxUses: 3 }))).toThrow()
  })

  test("keeps advisor out of legacy provider options", () => {
    const agent = Schema.decodeUnknownSync(ConfigAgentV1.Info)({ advisor: settings })
    expect(agent.advisor).toEqual(settings)
    expect(agent.options).not.toHaveProperty("advisor")
  })

  test("migrates the explicit setting without sending it as provider request data", () => {
    const legacy = Schema.decodeUnknownSync(ConfigAgentV1.Info)({ advisor: settings })
    const migrated = ConfigMigrateV1.migrateAgent(legacy)
    const current = Schema.decodeUnknownSync(ConfigAgent.Info)(migrated)
    expect(current).toMatchObject({ advisor: settings })
    expect(current.request?.body ?? {}).not.toHaveProperty("advisor")
  })

  test("preserves explicit disablement through migration", () => {
    const legacy = Schema.decodeUnknownSync(ConfigAgentV1.Info)({ advisor: false })
    expect(ConfigMigrateV1.migrateAgent(legacy)).toMatchObject({ advisor: false })
  })

  test("omits decoded undefined fields when migrating a partial setting", () => {
    const migrated = ConfigMigrateV1.migrateAgent({ advisor: { maxUses: undefined } })
    expect(Schema.decodeUnknownSync(ConfigAgent.Info)(migrated)).toMatchObject({ advisor: {} })
  })

  for (const advisor of [{ model: settings.model }, { maxUses: 3 }, false]) {
    test(`accepts a partial document value ${JSON.stringify(advisor)}`, () => {
      expect(Schema.decodeUnknownSync(ConfigAgentV1.Info)({ advisor })).toMatchObject({ advisor })
      expect(Schema.decodeUnknownSync(ConfigAgent.Info)({ advisor })).toMatchObject({ advisor })
    })
  }

  for (const advisor of [
    true,
    "opus",
    { model: " " },
    { model: "" },
    { maxUses: 0 },
    { maxUses: -1 },
    { maxUses: 1.5 },
  ]) {
    test(`rejects malformed document value ${JSON.stringify(advisor)}`, () => {
      expect(() => Schema.decodeUnknownSync(ConfigAgentV1.Info)({ advisor })).toThrow()
      expect(() => Schema.decodeUnknownSync(ConfigAgent.Info)({ advisor })).toThrow()
    })
  }
})
