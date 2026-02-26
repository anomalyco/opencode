import { afterEach, describe, expect, test } from "bun:test"
import { Cache } from "../../src/cache"
import { Discover } from "../../src/cache/discover"
import { Embed } from "../../src/cache/embed"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import type { SessionProcessor } from "../../src/session/processor"

const target = {
  init: 100,
  discover: 20,
  resolveToolsDelta: 30,
  tfidf: 50,
}

async function resolveToolsTime(cache: boolean) {
  await using tmp = await tmpdir({
    git: true,
    config: {
      experimental: {
        cache: {
          enabled: cache,
        },
      },
      agent: {
        build: {
          model: "opencode/kimi-k2.5-free",
        },
      },
    },
  })

  return Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parsed = await Provider.defaultModel()
      const model = await Provider.getModel(parsed.providerID, parsed.modelID)
      const agent = await Agent.get("build")
      const session = await Session.create({})
      const t0 = performance.now()
      await SessionPrompt.resolveTools({
        agent,
        model,
        session,
        bypassAgentCheck: true,
        messages: [],
        processor: {
          message: { id: "m" },
          partFromToolCall() {
            return undefined
          },
        } as unknown as SessionProcessor.Info,
      })
      const ms = performance.now() - t0
      await Session.remove(session.id)
      return ms
    },
  })
}

describe("cache.bench", () => {
  afterEach(() => {
    Cache.close()
  })

  test("Cache.init with 500 rows stays under target", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          cache: {
            enabled: true,
            maxTools: 500,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (let i = 0; i < 500; i++) {
          await Cache.registerTool({
            id: `bench_init_${i}`,
            name: `bench_init_${i}`,
            description: `bench init tool ${i}`,
            schema_json: "{}",
          })
        }
      },
    })

    Cache.close()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const t0 = performance.now()
        await Cache.init()
        const elapsed = performance.now() - t0
        expect(elapsed).toBeLessThan(target.init)
      },
    })
  })

  test("Discover.tools with 500 rows stays under target", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => {
      const text = `tool ${i} handles file and git task`
      return {
        id: `bench_discover_${i}`,
        name: `bench_discover_${i}`,
        description: text,
        schema_json: "{}",
        embedding: Embed.tfidf([text])[0],
        is_l1: 0,
        use_count: 0,
        registered: Date.now(),
      }
    })

    const t0 = performance.now()
    const result = await Discover.tools("git task", 10, rows)
    const elapsed = performance.now() - t0

    expect(result.length).toBe(10)
    expect(elapsed).toBeLessThan(target.discover)
  })

  test("resolveTools cache on/off delta stays under target", async () => {
    const off = await resolveToolsTime(false)
    const on = await resolveToolsTime(true)
    expect(on - off).toBeLessThan(target.resolveToolsDelta)
  })

  test("TF-IDF embedding generation for 100 strings stays under target", async () => {
    const data = Array.from({ length: 100 }, (_, i) => `embedding string ${i} github pull request`)
    const t0 = performance.now()
    const output = await Embed.generate(data)
    const elapsed = performance.now() - t0

    expect(output.length).toBe(100)
    expect(output.every((item) => item instanceof Float32Array)).toBe(true)
    expect(elapsed).toBeLessThan(target.tfidf)
  })
})