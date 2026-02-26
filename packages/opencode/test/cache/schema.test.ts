import { describe, expect, test } from "bun:test"
import z from "zod"
import { Config } from "../../src/config/config"

describe("cache.schema", () => {
  test("Config.Info JSON schema includes experimental.cache", () => {
    const json = z.toJSONSchema(Config.Info, { unrepresentable: "any" })
    const root = json as Record<string, unknown>
    const properties = root.properties as Record<string, unknown>
    const experimental = properties.experimental as Record<string, unknown>
    const experimentalProps = experimental.properties as Record<string, unknown>
    const cache = experimentalProps.cache as Record<string, unknown>
    const cacheProps = cache.properties as Record<string, unknown>

    expect(cache).toBeDefined()
    expect(cacheProps.enabled).toBeDefined()
    expect(cacheProps.maxTools).toBeDefined()
    expect(cacheProps.maxSkills).toBeDefined()
    expect(cacheProps.embedModel).toBeDefined()
  })
})