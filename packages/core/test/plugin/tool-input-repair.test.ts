import { describe, expect } from "bun:test"
import { Agent } from "@opencode-ai/core/agent"
import { ToolInputRepairPlugin } from "@opencode-ai/core/plugin/tool-input-repair"
import { Session } from "@opencode-ai/core/session"
import { SessionMessage } from "@opencode-ai/core/session/message"
import type { ToolHooks } from "@opencode-ai/plugin/effect/tool"
import { Tool } from "@opencode-ai/schema/tool"
import { Effect, type JsonSchema } from "effect"
import { it } from "../lib/effect"
import { host } from "./host"

function run(input: unknown, inputSchema: JsonSchema.JsonSchema) {
  const event: ToolHooks["execute.before"] = {
    tool: "test",
    input,
    sessionID: Session.ID.make("ses_repair"),
    agent: Agent.ID.make("build"),
    messageID: SessionMessage.ID.make("msg_repair"),
    id: Tool.CallID.make("call_repair"),
  }
  const events: ToolHooks = {
    "execute.before": event,
    "execute.after": { ...event, status: "error", error: new Tool.Error({ message: "unused" }) },
  }
  const base = host()
  return ToolInputRepairPlugin.Plugin.effect(
    host({
      tool: {
        ...base.tool,
        transform: (callback) =>
          Effect.sync(() => {
            const tool = {
              id: "test",
              name: "test",
              description: "Test repair",
              input: inputSchema,
              execute: () => Effect.succeed({ content: "unused" }),
            }
            callback({
              list: () => [tool],
              get: (id) => (id === tool.id ? tool : undefined),
              add: () => {},
              update: () => {},
              remove: () => {},
            })
            return { dispose: Effect.void }
          }),
        hook: (name, callback) => callback(events[name]).pipe(Effect.orDie, Effect.as({ dispose: Effect.void })),
      },
    }),
  ).pipe(Effect.as(event))
}

const object = (properties: Record<string, unknown>, required?: string[]) => ({
  type: "object" as const,
  properties,
  ...(required ? { required } : {}),
})

describe("tool input repair plugin", () => {
  it.effect("preserves valid input identity, nested containers, and unknown properties", () =>
    Effect.gen(function* () {
      const nested = { enabled: true }
      const items = [2, 3]
      const input = { count: 2, nested, items, extra: "keep" }
      const event = yield* run(
        input,
        object({
          count: { type: "integer" },
          nested: object({ enabled: { type: "boolean" } }),
          items: { type: "array", items: { type: "number" } },
        }),
      )

      expect(event.input).toBe(input)
      expect((event.input as typeof input).nested).toBe(nested)
      expect((event.input as typeof input).items).toBe(items)
    }),
  )

  it.effect("parses root objects and repairs nested stringified containers", () =>
    Effect.gen(function* () {
      const schema = object({
        count: { type: "integer" },
        item: object({ enabled: { type: "boolean" } }),
        list: { type: "array", items: { type: "integer" } },
      })

      expect(
        (yield* run('{"count":"2","item":"{\\"enabled\\":\\"false\\"}","list":"[\\"3\\"]"}', schema)).input,
      ).toEqual({
        count: 2,
        item: { enabled: false },
        list: [3],
      })
      expect((yield* run("{broken", schema)).input).toBe("{broken")
      expect((yield* run("[]", schema)).input).toBe("[]")
      expect((yield* run(null, schema)).input).toBeNull()
    }),
  )

  it.effect("removes extras only from explicitly closed objects without mutating inputs", () =>
    Effect.gen(function* () {
      const input = {
        known: "2",
        extra: true,
        closed: { keep: "3", extra: true },
        open: { keep: "4", extra: true },
        items: [{ keep: "5", extra: true }],
      }
      const event = yield* run(input, {
        ...object({
          known: { type: "integer" },
          closed: { ...object({ keep: { type: "integer" } }), additionalProperties: false },
          open: object({ keep: { type: "integer" } }),
          items: {
            type: "array",
            items: { ...object({ keep: { type: "integer" } }), additionalProperties: false },
          },
        }),
        additionalProperties: false,
      })

      expect(event.input).toEqual({
        known: 2,
        closed: { keep: 3 },
        open: { keep: 4, extra: true },
        items: [{ keep: 5 }],
      })
      expect(input.extra).toBeTrue()
      expect(input.closed.extra).toBeTrue()
      expect(input.items[0]?.extra).toBeTrue()
      expect((yield* run({ extra: true }, { ...object({}), additionalProperties: false })).input).toEqual({})
    }),
  )

  it.effect("preserves unknown keys when patterned ownership cannot be determined", () =>
    Effect.gen(function* () {
      const input = { known: 1, match: "2", extra: true }
      const event = yield* run(input, {
        ...object({ known: { type: "integer" } }),
        additionalProperties: false,
        patternProperties: { "^match$": { type: "integer" } },
      })

      expect(event.input).toBe(input)
      expect((event.input as typeof input).match).toBe("2")
      expect((event.input as typeof input).extra).toBeTrue()
    }),
  )

  it.effect("preserves properties that may belong to composed object schemas", () =>
    Effect.gen(function* () {
      const input = { name: "example", extra: true }

      for (const keyword of ["allOf", "anyOf", "oneOf"]) {
        const event = yield* run(input, {
          type: "object",
          [keyword]: [object({ name: { type: "string" } })],
          additionalProperties: false,
        })

        expect(event.input).toBe(input)
      }
    }),
  )

  it.effect("removes only optional nonnullable nulls and non-object empty placeholders", () =>
    Effect.gen(function* () {
      const input = {
        optional: null,
        required: null,
        nullable: null,
        union: null,
        constant: null,
        permissive: null,
        referenced: null,
        placeholder: {},
        array: {},
        requiredPlaceholder: {},
        object: {},
        unknown: null,
      }
      const event = yield* run(
        input,
        object(
          {
            optional: { type: "string" },
            required: { type: "string" },
            nullable: { type: "string", nullable: true },
            union: { anyOf: [{ type: "integer" }, { type: "null" }] },
            constant: { anyOf: [{ type: "integer" }, { const: null }] },
            permissive: { anyOf: [{ type: "integer" }, true] },
            referenced: { anyOf: [{ type: "integer" }, { $ref: "#/$defs/nullable" }] },
            placeholder: { type: "integer" },
            array: { type: "array", items: { type: "string" } },
            requiredPlaceholder: { type: "boolean" },
            object: { type: "object" },
            unknown: {},
          },
          ["required", "requiredPlaceholder"],
        ),
      )

      expect(event.input).toEqual({
        required: null,
        nullable: null,
        union: null,
        constant: null,
        permissive: null,
        referenced: null,
        requiredPlaceholder: {},
        object: {},
        unknown: null,
      })
      expect(input.optional).toBeNull()
      expect(input.placeholder).toEqual({})
    }),
  )

  it.effect("coerces numeric and boolean strings while preserving invalid and existing values", () =>
    Effect.gen(function* () {
      const input = {
        number: "1.5",
        integer: "42",
        enabled: "true",
        disabled: "false",
        valid: 3,
        empty: " ",
        infinite: "Infinity",
        fractional: "1.5",
        unsafe: "9007199254740992",
        uppercase: "TRUE",
      }
      const event = yield* run(
        input,
        object({
          number: { type: "number" },
          integer: { type: "integer" },
          enabled: { type: "boolean" },
          disabled: { type: "boolean" },
          valid: { type: "integer" },
          empty: { type: "number" },
          infinite: { type: "number" },
          fractional: { type: "integer" },
          unsafe: { type: "integer" },
          uppercase: { type: "boolean" },
        }),
      )

      expect(event.input).toEqual({ ...input, number: 1.5, integer: 42, enabled: true, disabled: false })
    }),
  )

  it.effect("wraps compatible scalars after repairing array items", () =>
    Effect.gen(function* () {
      const event = yield* run(
        {
          text: "one",
          integer: "42",
          boolean: "false",
          item: '{"count":"2"}',
          incompatible: 2,
          fractional: 1.5,
          unconstrained: "4",
        },
        object({
          text: { type: "array", items: { type: "string" } },
          integer: { type: "array", items: { type: "integer" } },
          boolean: { type: "array", items: { type: "boolean" } },
          item: { type: "array", items: object({ count: { type: "integer" } }) },
          incompatible: { type: "array", items: { type: "string" } },
          fractional: { type: "array", items: { type: "integer" } },
          unconstrained: { type: "array" },
        }),
      )

      expect(event.input).toEqual({
        text: ["one"],
        integer: [42],
        boolean: [false],
        item: [{ count: 2 }],
        incompatible: 2,
        fractional: 1.5,
        unconstrained: "4",
      })
    }),
  )

  it.effect("repairs nested question-like inputs without mutating original containers", () =>
    Effect.gen(function* () {
      const question = { question: "Pick one", multiple: "false", options: { label: "First", description: null } }
      const input = { questions: [question] }
      const event = yield* run(
        input,
        object({
          questions: {
            type: "array",
            items: object({
              question: { type: "string" },
              multiple: { type: "boolean" },
              options: {
                type: "array",
                items: object({ label: { type: "string" }, description: { type: "string" } }, ["label"]),
              },
            }),
          },
        }),
      )

      expect(event.input).toEqual({
        questions: [{ question: "Pick one", multiple: false, options: [{ label: "First" }] }],
      })
      expect(input).toEqual({ questions: [question] })
      expect(question.options.description).toBeNull()
    }),
  )

  it.effect("repairs unique nullable alternatives while preserving accepted union values", () =>
    Effect.gen(function* () {
      const input = {
        number: "2",
        boolean: "false",
        nullable: null,
        typed: "3",
        typedBoolean: "true",
        accepted: "4",
        valid: 5,
      }
      const event = yield* run(
        input,
        object({
          number: { anyOf: [{ type: "number" }, { type: "null" }] },
          boolean: { oneOf: [{ type: "boolean" }, { type: "null" }] },
          nullable: { anyOf: [{ type: "number" }, { type: "null" }] },
          typed: { type: ["integer", "null"] },
          typedBoolean: { type: ["boolean", "null"] },
          accepted: { anyOf: [{ type: "string" }, { type: "number" }] },
          valid: { type: ["number", "null"] },
        }),
      )

      expect(event.input).toEqual({ ...input, number: 2, boolean: false, typed: 3, typedBoolean: true })
    }),
  )

  it.effect("repairs tuple positions and rest items while preserving valid array identity", () =>
    Effect.gen(function* () {
      const valid = [2, false]
      const input = { prefix: ["2", "false", "3"], draft: '["4","true"]', valid, scalar: "5" }
      const event = yield* run(
        input,
        object({
          prefix: {
            type: "array",
            prefixItems: [{ type: "integer" }, { type: "boolean" }],
            items: { type: "number" },
          },
          draft: { type: "array", items: [{ type: "integer" }, { type: "boolean" }] },
          valid: { type: "array", prefixItems: [{ type: "integer" }, { type: "boolean" }] },
          scalar: { type: "array", prefixItems: [{ type: "integer" }] },
        }),
      )

      expect(event.input).toEqual({ prefix: [2, false, 3], draft: [4, true], valid, scalar: "5" })
      expect((event.input as typeof input).valid).toBe(valid)
      expect(input.prefix).toEqual(["2", "false", "3"])
    }),
  )

  it.effect("repairs typed dictionaries and straightforward local references", () =>
    Effect.gen(function* () {
      const input = {
        modern: "2",
        legacy: "false",
        nested: { count: "3" },
        dictionary: { first: "4" },
        missing: "5",
        pointer: "6",
      }
      const event = yield* run(input, {
        ...object({
          modern: { $ref: "#/$defs/integer" },
          legacy: { $ref: "#/definitions/boolean" },
          nested: { $ref: "#/$defs/nested" },
          dictionary: { type: "object", additionalProperties: { $ref: "#/$defs/integer" } },
          missing: { $ref: "#/$defs/missing" },
          pointer: { $ref: "#/$defs/nested/properties/count" },
        }),
        $defs: {
          integer: { type: "integer" },
          nested: object({ count: { $ref: "#/$defs/integer" } }),
        },
        definitions: { boolean: { type: "boolean" } },
      })

      expect(event.input).toEqual({
        modern: 2,
        legacy: false,
        nested: { count: 3 },
        dictionary: { first: 4 },
        missing: "5",
        pointer: "6",
      })
      expect(input.nested.count).toBe("3")
      expect(input.dictionary.first).toBe("4")
    }),
  )

  it.effect("leaves ambiguous unions, compositions, and unsupported roots unchanged", () =>
    Effect.gen(function* () {
      const input = { numeric: "2", objects: { value: "3" }, both: "4", composed: "5", unknown: "6" }
      const event = yield* run(
        input,
        object({
          numeric: { anyOf: [{ type: "number" }, { type: "integer" }] },
          objects: {
            oneOf: [
              object({ value: { type: "integer" } }, ["value"]),
              object({ value: { type: "number" } }, ["value"]),
            ],
          },
          both: { anyOf: [{ type: "integer" }], oneOf: [{ type: "integer" }] },
          composed: { allOf: [{ type: "integer" }] },
          unknown: {},
        }),
      )

      expect(event.input).toBe(input)
      expect((yield* run(input, { properties: { numeric: { type: "integer" } } })).input).toBe(input)
      expect((yield* run(input, { allOf: [object({ numeric: { type: "integer" } })] })).input).toBe(input)
    }),
  )
})
