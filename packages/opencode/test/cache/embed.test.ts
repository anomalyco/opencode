import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as ai from "ai"
import { Embed } from "../../src/cache/embed"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Cache } from "../../src/cache"

describe("cache.embed", () => {
  afterEach(() => {
    Cache.close()
  })

  test("similarity is 1 for identical vectors", () => {
    const x = new Float32Array([1, 2, 3])
    expect(Embed.similarity(x, x)).toBe(1)
  })

  test("similarity is low for opposite vectors", () => {
    const x = new Float32Array([1, 2, 3])
    const y = new Float32Array([-1, -2, -3])
    expect(Embed.similarity(x, y)).toBeLessThan(0.1)
  })

  test("generate falls back to tfidf without provider", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          cache: {
            enabled: true,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        const rows = await Embed.generate(["hello world"])
        expect(rows[0]).toBeInstanceOf(Float32Array)
        expect(rows[0].length).toBeGreaterThan(0)
      },
    })
  })

  test("hash is stable", () => {
    expect(Embed.hash("same")).toBe(Embed.hash("same"))
  })

  test("generate uses embedMany when OpenAI embed model is configured", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    const mocked = spyOn(ai, "embedMany").mockImplementation(
      (async () =>
        ({
          embeddings: [[0.1, 0.2, 0.3]],
        }) as Awaited<ReturnType<typeof ai.embedMany>>) as typeof ai.embedMany,
    )

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          experimental: {
            cache: {
              enabled: true,
              embedModel: "openai/text-embedding-3-small",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        async fn() {
          const vectors = await Embed.generate(["hello world"])
          expect(mocked).toHaveBeenCalledTimes(1)
          expect(vectors[0]).toEqual(new Float32Array([0.1, 0.2, 0.3]))

          await Cache.registerTool({
            id: "embed_openai_tool",
            name: "embed_openai_tool",
            description: "Tool for embed dimension checks",
            schema_json: "{}",
          })

          const rows = await Cache.allToolRows()
          const match = rows.find((row) => row.id === "embed_openai_tool")
          expect(match?.embedding?.length).toBe(3)
        },
      })
    } finally {
      mocked.mockRestore()
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  })
})
