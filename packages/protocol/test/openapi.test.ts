import { expect, test } from "bun:test"
import { Schema } from "effect"

const Document = Schema.Struct({
  components: Schema.Struct({
    schemas: Schema.Record(Schema.String, Schema.Unknown),
  }),
})
const Union = Schema.Struct({ anyOf: Schema.Array(Schema.Unknown) })

test("documents SSE payload schemas", async () => {
  const raw: unknown = await Bun.file(new URL("../openapi.json", import.meta.url)).json()
  const document = Schema.decodeUnknownSync(Document)(raw)
  const schemas = document.components.schemas

  expect(schemas.V2EventEncoded).toMatchObject({
    contentSchema: { $ref: "#/components/schemas/V2Event" },
  })
  expect(schemas.SessionLogItemEncoded).toMatchObject({
    contentSchema: { $ref: "#/components/schemas/SessionLogItem" },
  })
  expect(Schema.decodeUnknownSync(Union)(schemas.V2Event).anyOf.length).toBeGreaterThan(1)
  expect(Schema.decodeUnknownSync(Union)(schemas.SessionLogItem).anyOf.length).toBeGreaterThan(1)

  const references = [...JSON.stringify(raw).matchAll(/#\/components\/schemas\/([^"\\]+)/g)].map((match) => match[1])
  const missing = [...new Set(references.filter((name) => !(name in schemas)))]
  expect(missing).toEqual([])
})
