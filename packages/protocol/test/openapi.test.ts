import { expect, test } from "bun:test"

test("links SSE data to payload schemas", async () => {
  const schemas = (await Bun.file(new URL("../openapi.json", import.meta.url)).json()).components.schemas

  expect(schemas.V2EventEncoded.contentSchema).toEqual({ $ref: "#/components/schemas/V2Event" })
  expect(schemas.SessionLogItemEncoded.contentSchema).toEqual({ $ref: "#/components/schemas/SessionLogItem" })
  expect(schemas.V2Event.anyOf.length).toBeGreaterThan(1)
  expect(schemas.SessionLogItem.anyOf.length).toBeGreaterThan(1)
})
