import { afterEach, describe, expect, test } from "bun:test"

import {
  buildClientParams as buildClientParamsV1,
  type FieldsConfig as FieldsConfigV1,
} from "../src/gen/core/params.gen"
import {
  buildClientParams as buildClientParamsV2,
  type FieldsConfig as FieldsConfigV2,
} from "../src/v2/gen/core/params.gen"

const pollutedKey = "__opencode_sdk_polluted__"

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>)[pollutedKey]
})

describe("buildClientParams", () => {
  test("ignores runtime parameter slots outside the generated slot allowlist", () => {
    const fields = [{ in: "__proto__", key: pollutedKey }] as unknown as FieldsConfigV1

    const params = buildClientParamsV1([true], fields)

    expect(({} as Record<string, unknown>)[pollutedKey]).toBeUndefined()
    expect(params).toEqual({})
  })

  test("ignores invalid allowExtra slots", () => {
    const fields = [
      {
        allowExtra: JSON.parse('{"__proto__":true}'),
      },
    ] as unknown as FieldsConfigV1

    const params = buildClientParamsV1([{ [pollutedKey]: true }], fields)

    expect(({} as Record<string, unknown>)[pollutedKey]).toBeUndefined()
    expect(params).toEqual({})
  })

  test("keeps valid runtime slots working", () => {
    const params = buildClientParamsV1([{ id: "abc" }], [{ allowExtra: { query: true } }])

    expect(params).toEqual({ query: { id: "abc" } })
  })
})

describe("buildClientParams v2", () => {
  test("ignores runtime parameter slots outside the generated slot allowlist", () => {
    const fields = [{ in: "__proto__", key: pollutedKey }] as unknown as FieldsConfigV2

    const params = buildClientParamsV2([true], fields)

    expect(({} as Record<string, unknown>)[pollutedKey]).toBeUndefined()
    expect(params).toEqual({})
  })

  test("ignores invalid map-only transport slots", () => {
    const fields = [{ key: pollutedKey, map: "__proto__" }] as unknown as FieldsConfigV2

    const params = buildClientParamsV2([{ [pollutedKey]: true }], fields)

    expect(({} as Record<string, unknown>)[pollutedKey]).toBeUndefined()
    expect(params).toEqual({})
  })

  test("keeps valid map-only transport slots working", () => {
    const params = buildClientParamsV2([{ location: "tokyo" }], [{ key: "location", map: "query" }])

    expect(params).toEqual({ query: "tokyo" })
  })
})
