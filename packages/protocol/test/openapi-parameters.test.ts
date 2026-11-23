import { expect, test } from "bun:test"
import { liftParameterDescriptions } from "../script/openapi-parameters.js"

const operation = (parameter: object) => ({ paths: { "/test": { get: { parameters: [parameter] } } } })

test("moves a schema description onto the parameter", () => {
  expect(
    liftParameterDescriptions(
      operation({ name: "limit", in: "query", schema: { anyOf: [{ type: "string" }], description: "Page size." } }),
    ),
  ).toEqual(
    operation({ name: "limit", in: "query", description: "Page size.", schema: { anyOf: [{ type: "string" }] } }),
  )
})

test("moves a key description out of allOf and unwraps a lone reference", () => {
  expect(
    liftParameterDescriptions(
      operation({
        name: "sessionID",
        in: "path",
        schema: { allOf: [{ $ref: "#/components/schemas/Session.ID" }, { description: "Session ID." }] },
      }),
    ),
  ).toEqual(
    operation({
      name: "sessionID",
      in: "path",
      description: "Session ID.",
      schema: { $ref: "#/components/schemas/Session.ID" },
    }),
  )
  expect(
    liftParameterDescriptions(
      operation({ name: "name", in: "query", schema: { type: "string", allOf: [{ description: "Name." }] } }),
    ),
  ).toEqual(operation({ name: "name", in: "query", description: "Name.", schema: { type: "string" } }))
})

test("keeps a description already on the parameter", () => {
  const document = operation({ name: "cursor", in: "query", description: "Cursor.", schema: { type: "string" } })
  expect(liftParameterDescriptions(document)).toEqual(document)
})
