import { describe, expect, test } from "bun:test"
import path from "path"
import { SessionCompaction } from "../../src/session/compaction"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import type { Provider } from "../../src/provider/provider"

Log.init({ print: false })

function createModel(opts: {
  context: number
  output: number
  input?: number
  compaction?: { threshold?: number }
}): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
    name: "Test",
    limit: {
      context: opts.context,
      input: opts.input,
      output: opts.output,
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/anthropic" },
    options: {},
    compaction: opts.compaction,
    variants: {},
    headers: {},
    release_date: "2024-01-01",
  } as Provider.Model
}

describe("session.compaction.isOverflow with threshold", () => {
  test("uses configured threshold when set in model", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Threshold 0.5 (50,000 tokens)
        const model = createModel({ 
            context: 100_000, 
            output: 10_000,
            compaction: { threshold: 0.5 } 
        })
        
        // 49,000 tokens - Should NOT overflow
        expect(await SessionCompaction.isOverflow({ 
            tokens: { input: 49_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, 
            model 
        })).toBe(false)
        
        // 51,000 tokens - Should overflow
        expect(await SessionCompaction.isOverflow({ 
            tokens: { input: 51_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, 
            model 
        })).toBe(true)
      },
    })
  })

  test("uses global config threshold", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { threshold: 0.3 },
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Context 100,000. Threshold 0.3 => 30,000.
        const model = createModel({ context: 100_000, output: 10_000 })
        
        // 29,000 tokens - No overflow
        expect(await SessionCompaction.isOverflow({ 
            tokens: { input: 29_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, 
            model 
        })).toBe(false)
        
        // 31,000 tokens - Overflow
        expect(await SessionCompaction.isOverflow({ 
            tokens: { input: 31_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, 
            model 
        })).toBe(true)
      },
    })
  })

  test("model override takes precedence over global config", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            compaction: { threshold: 0.3 }, // Global 30%
          }),
        )
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Model override 80% (80,000)
        const model = createModel({ 
            context: 100_000, 
            output: 10_000,
            compaction: { threshold: 0.8 } 
        })
        
        // 50,000 tokens (would overflow global 30% but not model 80%)
        expect(await SessionCompaction.isOverflow({ 
            tokens: { input: 50_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, 
            model 
        })).toBe(false)
        
        // 81,000 tokens - Overflow
        expect(await SessionCompaction.isOverflow({ 
            tokens: { input: 81_000, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, 
            model 
        })).toBe(true)
      },
    })
  })
})
