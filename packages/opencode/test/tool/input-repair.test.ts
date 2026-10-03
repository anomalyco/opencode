import { describe, expect, test } from "bun:test"
import { ToolInputRepair } from "@/tool/input-repair"

const object = (properties: Record<string, unknown>, required?: string[]) => ({
  type: "object" as const,
  properties,
  ...(required ? { required } : {}),
})

describe("ToolInputRepair.repair", () => {
  test("preserves valid input identity, nested containers, and unknown properties", () => {
    const nested = { enabled: true }
    const items = [2, 3]
    const input = { count: 2, nested, items, extra: "keep" }
    const output = ToolInputRepair.repair(
      input,
      object({
        count: { type: "integer" },
        nested: object({ enabled: { type: "boolean" } }),
        items: { type: "array", items: { type: "number" } },
      }),
    )

    expect(output).toBe(input)
    expect((output as typeof input).nested).toBe(nested)
    expect((output as typeof input).items).toBe(items)
  })

  test("parses root objects and repairs nested stringified containers", () => {
    const schema = object({
      count: { type: "integer" },
      item: object({ enabled: { type: "boolean" } }),
      list: { type: "array", items: { type: "integer" } },
    })

    expect(
      ToolInputRepair.repair('{"count":"2","item":"{\\"enabled\\":\\"false\\"}","list":"[\\"3\\"]"}', schema),
    ).toEqual({
      count: 2,
      item: { enabled: false },
      list: [3],
    })
    expect(ToolInputRepair.repair("{broken", schema)).toBe("{broken")
    expect(ToolInputRepair.repair("[]", schema)).toBe("[]")
    expect(ToolInputRepair.repair(null, schema)).toBeNull()
  })

  test("removes extras only from explicitly closed objects without mutating inputs", () => {
    const input = {
      known: "2",
      extra: true,
      closed: { keep: "3", extra: true },
      open: { keep: "4", extra: true },
      items: [{ keep: "5", extra: true }],
    }
    const output = ToolInputRepair.repair(input, {
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

    expect(output).toEqual({
      known: 2,
      closed: { keep: 3 },
      open: { keep: 4, extra: true },
      items: [{ keep: 5 }],
    })
    expect(input.extra).toBeTrue()
    expect(input.closed.extra).toBeTrue()
    expect(input.items[0]?.extra).toBeTrue()
    expect(ToolInputRepair.repair({ extra: true }, { ...object({}), additionalProperties: false })).toEqual({})
  })

  test("preserves unknown keys when patterned ownership cannot be determined", () => {
    const input = { known: 1, match: "2", extra: true }
    const output = ToolInputRepair.repair(input, {
      ...object({ known: { type: "integer" } }),
      additionalProperties: false,
      patternProperties: { "^match$": { type: "integer" } },
    })

    expect(output).toBe(input)
    expect((output as typeof input).match).toBe("2")
    expect((output as typeof input).extra).toBeTrue()
  })

  test("preserves properties that may belong to composed object schemas", () => {
    const input = { name: "example", extra: true }

    for (const keyword of ["allOf", "anyOf", "oneOf"]) {
      expect(
        ToolInputRepair.repair(input, {
          type: "object",
          [keyword]: [object({ name: { type: "string" } })],
          additionalProperties: false,
        }),
      ).toBe(input)
    }
  })

  test("removes only optional nonnullable nulls and non-object empty placeholders", () => {
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
    const output = ToolInputRepair.repair(
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

    expect(output).toEqual({
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
  })

  test("preserves nulls whose validity is hidden inside compositions", () => {
    const input = { wrapped: null, enumerated: null, permissive: null, constant: null }
    expect(
      ToolInputRepair.repair(
        input,
        object({
          wrapped: { anyOf: [{ type: ["string", "null"] }] },
          enumerated: { anyOf: [{ enum: [null, "keep"] }] },
          permissive: { anyOf: [{}] },
          constant: { type: "string", const: "keep" },
        }),
      ),
    ).toBe(input)
  })

  test("preserves optional-looking nulls when the parent composes requirements", () => {
    const input = { value: null }
    expect(
      ToolInputRepair.repair(input, {
        ...object({ value: { type: "string" } }),
        allOf: [{ required: ["value"] }],
      }),
    ).toBe(input)
  })

  test("coerces numeric and boolean strings while preserving invalid and existing values", () => {
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
    const output = ToolInputRepair.repair(
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

    expect(output).toEqual({ ...input, number: 1.5, integer: 42, enabled: true, disabled: false })
  })

  test("wraps compatible scalars after repairing array items", () => {
    const output = ToolInputRepair.repair(
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

    expect(output).toEqual({
      text: ["one"],
      integer: [42],
      boolean: [false],
      item: [{ count: 2 }],
      incompatible: 2,
      fractional: 1.5,
      unconstrained: "4",
    })
  })

  test("repairs nested question-like inputs without mutating original containers", () => {
    const question = { question: "Pick one", multiple: "false", options: { label: "First", description: null } }
    const input = { questions: [question] }
    const output = ToolInputRepair.repair(
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

    expect(output).toEqual({
      questions: [{ question: "Pick one", multiple: false, options: [{ label: "First" }] }],
    })
    expect(input).toEqual({ questions: [question] })
    expect(question.options.description).toBeNull()
  })

  test("repairs unique nullable alternatives while preserving accepted union values", () => {
    const input = {
      number: "2",
      boolean: "false",
      nullable: null,
      typed: "3",
      typedBoolean: "true",
      accepted: "4",
      valid: 5,
    }
    const output = ToolInputRepair.repair(
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

    expect(output).toEqual({ ...input, number: 2, boolean: false, typed: 3, typedBoolean: true })
  })

  test("repairs tuple positions and rest items while preserving valid array identity", () => {
    const valid = [2, false]
    const input = { prefix: ["2", "false", "3"], draft: '["4","true"]', valid, scalar: "5" }
    const output = ToolInputRepair.repair(
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

    expect(output).toEqual({ prefix: [2, false, 3], draft: [4, true], valid, scalar: "5" })
    expect((output as typeof input).valid).toBe(valid)
    expect(input.prefix).toEqual(["2", "false", "3"])
  })

  test("repairs typed dictionaries and straightforward local references", () => {
    const input = {
      modern: "2",
      legacy: "false",
      nested: { count: "3" },
      dictionary: { first: "4" },
      missing: "5",
      pointer: "6",
      escaped: "7",
    }
    const output = ToolInputRepair.repair(input, {
      ...object({
        modern: { $ref: "#/$defs/integer" },
        legacy: { $ref: "#/definitions/boolean" },
        nested: { $ref: "#/$defs/nested" },
        dictionary: { type: "object", additionalProperties: { $ref: "#/$defs/integer" } },
        missing: { $ref: "#/$defs/missing" },
        pointer: { $ref: "#/$defs/nested/properties/count" },
        escaped: { $ref: "#/$defs/a~1b~0c" },
      }),
      $defs: {
        integer: { type: "integer" },
        "a/b~c": { type: "integer" },
        nested: object({ count: { $ref: "#/$defs/integer" } }),
      },
      definitions: { boolean: { type: "boolean" } },
    })

    expect(output).toEqual({
      modern: 2,
      legacy: false,
      nested: { count: 3 },
      dictionary: { first: 4 },
      missing: "5",
      pointer: "6",
      escaped: 7,
    })
    expect(input.nested.count).toBe("3")
    expect(input.dictionary.first).toBe("4")
  })

  test("leaves ambiguous unions, compositions, and unsupported roots unchanged", () => {
    const input = { numeric: "2", objects: { value: "3" }, both: "4", composed: "5", unknown: "6" }
    expect(
      ToolInputRepair.repair(
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
      ),
    ).toBe(input)
    expect(ToolInputRepair.repair(input, { properties: { numeric: { type: "integer" } } })).toBe(input)
    expect(ToolInputRepair.repair(input, { allOf: [object({ numeric: { type: "integer" } })] })).toBe(input)
  })

  test("leaves input unchanged when the schema is missing or not an object", () => {
    const input = { count: "2" }
    expect(ToolInputRepair.repair(input, undefined)).toBe(input)
    expect(ToolInputRepair.repair(input, null)).toBe(input)
    expect(ToolInputRepair.repair(input, "object")).toBe(input)
    expect(ToolInputRepair.repair(input, [object({ count: { type: "integer" } })])).toBe(input)
  })

  test("stops descending past the maximum nesting depth", () => {
    const nest = (levels: number) => ({
      schema: Array.from({ length: levels }).reduce<Record<string, unknown>>(
        (inner) => object({ next: inner }),
        object({ count: { type: "integer" } }),
      ),
      input: Array.from({ length: levels }).reduce<Record<string, unknown>>((inner) => ({ next: inner }), {
        count: "1",
      }),
    })
    const shallow = nest(5)
    const deep = nest(7)

    expect(ToolInputRepair.repair(shallow.input, shallow.schema)).toEqual({
      next: { next: { next: { next: { next: { count: 1 } } } } },
    })
    expect(ToolInputRepair.repair(deep.input, deep.schema)).toBe(deep.input)
  })
})

describe("ToolInputRepair.repair on MCP server schemas seen in the wild", () => {
  test("coerces a numeric string for a pydantic `int | None` parameter", () => {
    const schema = {
      type: "object",
      properties: {
        employee_id: { anyOf: [{ type: "integer" }, { type: "null" }], default: null, title: "Employee Id" },
      },
      title: "get_employeeArguments",
    }
    expect(ToolInputRepair.repair({ employee_id: "88708" }, schema)).toEqual({ employee_id: 88708 })
    const valid = { employee_id: 88708 }
    expect(ToolInputRepair.repair(valid, schema)).toBe(valid)
    const empty = { employee_id: null }
    expect(ToolInputRepair.repair(empty, schema)).toBe(empty)
  })

  test("parses a stringified $ref object and coerces an enum number (#52390)", () => {
    const schema = {
      type: "object",
      properties: {
        settings: { $ref: "#/$defs/Settings" },
        attempts: { type: "integer", enum: [1, 3] },
      },
      required: ["settings"],
      $defs: {
        Settings: {
          type: "object",
          properties: { notifications: { type: "boolean" }, retries: { type: "integer" } },
          required: ["notifications"],
        },
      },
    }
    expect(
      ToolInputRepair.repair({ settings: '{"notifications":false,"retries":"2"}', attempts: "3" }, schema),
    ).toEqual({ settings: { notifications: false, retries: 2 }, attempts: 3 })
  })

  test("parses a stringified nullable $ref object (#45211)", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        metadata: { anyOf: [{ $ref: "#/$defs/Metadata" }, { type: "null" }], default: null },
      },
      required: ["name"],
      $defs: {
        Metadata: {
          type: "object",
          properties: { priority: { type: "integer" }, tags: { type: "array", items: { type: "string" } } },
        },
      },
    }
    expect(ToolInputRepair.repair({ name: "task", metadata: '{"priority":"1","tags":["a","b"]}' }, schema)).toEqual({
      name: "task",
      metadata: { priority: 1, tags: ["a", "b"] },
    })
  })

  test("parses a stringified required object body (#28472)", () => {
    const schema = {
      type: "object",
      properties: { path: { type: "string" }, body: { type: "object" } },
      required: ["path", "body"],
    }
    expect(ToolInputRepair.repair({ path: "/items", body: '{"title":"x","done":false}' }, schema)).toEqual({
      path: "/items",
      body: { title: "x", done: false },
    })
  })
})
