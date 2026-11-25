import { expect, test } from "bun:test"
import path from "node:path"
import { createModelPreferenceRepository, cycleModelSpeed, decodeModelPreference } from "../src/model-preference"
import { tmpdir } from "./fixture/fixture"

test("repairs known model preferences and preserves unrelated fields", () => {
  expect(
    decodeModelPreference({
      unrelated: { keep: true },
      recent: [{ providerID: "openai", modelID: "gpt-5", ignored: true }, null],
      favorite: "malformed",
      variant: { "openai/gpt-5": "high", default: "default", invalid: 42 },
      speed: { "openai/gpt-5": "fast", invalid: 42 },
    }),
  ).toEqual({
    unrelated: { keep: true },
    recent: [{ providerID: "openai", modelID: "gpt-5" }],
    favorite: [],
    variant: { "openai/gpt-5": "high", default: "default" },
    speed: { "openai/gpt-5": "fast" },
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
    repository.saveSpeed(openai, "fast"),
  ])
  expect(await Bun.file(file).json()).toEqual({
    unrelated: "keep",
    recent: [openai],
    favorite: [],
    variant: { "openai/org/gpt-5": "high", "anthropic/claude/sonnet": "low" },
    speed: { "openai/org/gpt-5": "fast" },
  })

  // The standard speed is the absence of an entry.
  await repository.saveSpeed(openai, undefined)
  expect((await Bun.file(file).json()).speed).toEqual({})

  await repository.saveVariant(openai, "default")
  expect(await repository.resolveVariant(openai)).toBeUndefined()
  expect((await Bun.file(file).json()).variant).toEqual({
    "openai/org/gpt-5": "default",
    "anthropic/claude/sonnet": "low",
  })
})

test("cycles speeds from slowest to fastest through the standard speed", () => {
  const speeds = [
    { id: "flex", faster: false },
    { id: "fast", faster: true },
    { id: "ultrafast", faster: true },
  ]
  expect(cycleModelSpeed("flex", speeds)).toBeUndefined()
  expect(cycleModelSpeed(undefined, speeds)).toBe("fast")
  expect(cycleModelSpeed("fast", speeds)).toBe("ultrafast")
  expect(cycleModelSpeed("ultrafast", speeds)).toBe("flex")
  // A speed the model no longer has restarts from the slowest.
  expect(cycleModelSpeed("gone", speeds)).toBe("flex")
})
