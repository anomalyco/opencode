import { expect, test } from "bun:test"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"

test("the OpenAPI document keeps string pattern constraints from protocol schemas", () => {
  const patterns = new Set<string>()
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(collect)
    if (typeof value !== "object" || value === null) return
    Object.entries(value).forEach(([key, item]) => {
      if (key === "pattern" && typeof item === "string") patterns.add(item)
      collect(item)
    })
  }
  collect(OpenApi.fromApi(ClientApi))

  expect([...patterns]).toEqual(
    expect.arrayContaining([
      "^[^/#]+\\/[^#]+(?:#[^#]+)?$",
      "^[^/#]+$",
      "^[^#]+$",
      "^#[0-9a-fA-F]{6}$",
      "^[a-z0-9][a-z0-9._-]*$",
      "^[a-z][a-z0-9._-]*$",
      "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
    ]),
  )
})
