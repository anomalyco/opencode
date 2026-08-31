import { expect, test } from "bun:test"
import path from "node:path"
import { createModelPreferenceRepository, decodeModelPreference } from "../src/model-preference"
import { tmpdir } from "./fixture/fixture"

test("repairs known model preferences and preserves unrelated fields", () => {
  expect(
    decodeModelPreference({
      unrelated: { keep: true },
      recent: [{ providerID: "openai", modelID: "gpt-5", ignored: true }, null],
      favorite: "malformed",
      variant: { "openai/gpt-5": "high", default: "default", invalid: 42 },
    }),
  ).toEqual({
    unrelated: { keep: true },
    recent: [{ providerID: "openai", modelID: "gpt-5" }],
    favorite: [],
    variant: { "openai/gpt-5": "high" },
  })
})

test("atomically serializes model preference updates", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "model.json")
  await Bun.write(file, JSON.stringify({ unrelated: "keep", favorite: [], variant: {} }))
  const repository = createModelPreferenceRepository(file)
  const openai = { providerID: "openai", modelID: "org/gpt-5" }
  const anthropic = { providerID: "anthropic", modelID: "claude/sonnet" }

  await Promise.all([
    repository.addRecent(openai),
    repository.saveVariant(openai, "high"),
    repository.saveVariant(anthropic, "low"),
  ])
  expect(await Bun.file(file).json()).toEqual({
    unrelated: "keep",
    recent: [openai],
    favorite: [],
    variant: { "openai/org/gpt-5": "high", "anthropic/claude/sonnet": "low" },
  })

  await repository.saveVariant(openai, "default")
  expect(await repository.resolveVariant(openai)).toBeUndefined()
  expect((await Bun.file(file).json()).variant).toEqual({ "anthropic/claude/sonnet": "low" })
})

test("serializes updates across repositories", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "model.json")
  await Bun.write(file, JSON.stringify({ recent: [], favorite: [], variant: {} }))
  const first = createModelPreferenceRepository(file)
  const second = createModelPreferenceRepository(file)
  const openai = { providerID: "openai", modelID: "gpt-5" }
  const anthropic = { providerID: "anthropic", modelID: "claude-sonnet" }

  await Promise.all([first.setFavorite(openai, true), second.addRecent(anthropic), second.saveVariant(openai, "high")])

  expect(await first.load()).toEqual({
    recent: [anthropic],
    favorite: [openai],
    variant: { "openai/gpt-5": "high" },
  })
})

test("subscribes to updates from another repository", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "model.json")
  await Bun.write(file, JSON.stringify({ recent: [], favorite: [], variant: {} }))
  const first = createModelPreferenceRepository(file)
  const second = createModelPreferenceRepository(file)
  const openai = { providerID: "openai", modelID: "gpt-5" }
  const changed = Promise.withResolvers<void>()
  const unsubscribe = first.subscribe((value) => {
    if (value.favorite.some((item) => item.providerID === openai.providerID && item.modelID === openai.modelID))
      changed.resolve()
  })

  try {
    await second.setFavorite(openai, true)
    await Promise.race([
      changed.promise,
      Bun.sleep(2_000).then(() => {
        throw new Error("timed out waiting for model preference update")
      }),
    ])
  } finally {
    unsubscribe()
  }
})
