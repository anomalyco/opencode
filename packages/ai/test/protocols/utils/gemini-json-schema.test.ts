import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { GeminiJsonSchema } from "../../../src/protocols/utils/gemini-json-schema.js"
import { it } from "../../lib/effect"

describe("GeminiJsonSchema.normalize", () => {
  it.effect("infers type string from string-only enum without type", () =>
    Effect.gen(function* () {
      const result = yield* Effect.sync(() =>
        GeminiJsonSchema.normalize({
          type: "object",
          properties: {
            window: { enum: ["current", "separate"], description: "Where agents open their tabs" },
          },
        }),
      )
      expect(result.properties).toEqual({
        window: { type: "string", enum: ["current", "separate"], description: "Where agents open their tabs" },
      })
    }),
  )

  it.effect("infers type integer from integer-only enum without type", () =>
    Effect.gen(function* () {
      const result = yield* Effect.sync(() =>
        GeminiJsonSchema.normalize({
          type: "object",
          properties: {
            idleMinutes: { enum: [10, 30, 60] },
          },
        }),
      )
      expect(result.properties).toEqual({
        idleMinutes: { type: "integer", enum: [10, 30, 60] },
      })
    }),
  )

  it.effect("infers type boolean from boolean-only enum without type", () =>
    Effect.gen(function* () {
      const result = yield* Effect.sync(() =>
        GeminiJsonSchema.normalize({
          type: "object",
          properties: {
            enabled: { enum: [true, false] },
          },
        }),
      )
      expect(result.properties).toEqual({
        enabled: { type: "boolean", enum: [true, false] },
      })
    }),
  )

  it.effect("splits mixed-type enum into anyOf typed variants", () =>
    Effect.gen(function* () {
      const result = yield* Effect.sync(() =>
        GeminiJsonSchema.normalize({
          type: "object",
          properties: {
            idleMinutes: { enum: [10, 30, 60, "never"] },
          },
        }),
      )
      expect(result.properties).toEqual({
        idleMinutes: {
          anyOf: [
            { type: "integer", enum: [10, 30, 60] },
            { type: "string", enum: ["never"] },
          ],
        },
      })
    }),
  )

  it.effect("infers type from const without type", () =>
    Effect.gen(function* () {
      const result = yield* Effect.sync(() =>
        GeminiJsonSchema.normalize({
          type: "object",
          properties: {
            mode: { const: "fast" },
          },
        }),
      )
      expect(result.properties).toEqual({
        mode: { type: "string", const: "fast" },
      })
    }),
  )

  it.effect("does not add type when type is already present", () =>
    Effect.gen(function* () {
      const result = yield* Effect.sync(() =>
        GeminiJsonSchema.normalize({
          type: "object",
          properties: {
            window: { type: "string", enum: ["current", "separate"] },
          },
        }),
      )
      expect(result.properties).toEqual({
        window: { type: "string", enum: ["current", "separate"] },
      })
    }),
  )

  it.effect("handles nested enum-only properties", () =>
    Effect.gen(function* () {
      const result = yield* Effect.sync(() =>
        GeminiJsonSchema.normalize({
          type: "object",
          properties: {
            set: {
              type: "object",
              properties: {
                window: { enum: ["current", "separate"], description: "tabs" },
                idleMinutes: { enum: [10, 30, 60, "never"] },
              },
            },
          },
        }),
      )
      expect(result.properties).toEqual({
        set: {
          type: "object",
          properties: {
            window: { type: "string", enum: ["current", "separate"], description: "tabs" },
            idleMinutes: {
              anyOf: [
                { type: "integer", enum: [10, 30, 60] },
                { type: "string", enum: ["never"] },
              ],
            },
          },
        },
      })
    }),
  )
})
