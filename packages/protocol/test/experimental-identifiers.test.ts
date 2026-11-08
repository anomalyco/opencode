import { expect, test } from "bun:test"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"

const methods = ["get", "put", "post", "delete", "patch", "head", "options", "trace"] as const

test("routes under /api/experimental, and only those, have experimental.* identifiers", () => {
  const operations = Object.entries(OpenApi.fromApi(ClientApi).paths).flatMap(([path, item]) =>
    methods.flatMap((method) => {
      const operation = item[method]
      return operation ? [{ path, identifier: operation.operationId }] : []
    }),
  )
  const offenders = operations
    .filter(
      ({ path, identifier }) =>
        (path === "/api/experimental" || path.startsWith("/api/experimental/")) !==
        identifier.startsWith("experimental."),
    )
    .map(({ path, identifier }) => `${identifier} ${path}`)

  expect(operations.length).toBeGreaterThan(100)
  expect(offenders).toEqual([])
})

test("message times belong to session list items, not the shared session or import schema", () => {
  const document = OpenApi.fromApi(ClientApi)
  const schemas = document.components.schemas

  expect(schemas["Session.Info"]).not.toHaveProperty("properties.experimental")
  expect(schemas["Session.ListInfo"]).toHaveProperty("properties.experimental.properties.time")
  expect(schemas.SessionsResponse).toHaveProperty("properties.data.items.$ref", "#/components/schemas/Session.ListInfo")
  expect(document.paths["/api/experimental/session/import"]).toHaveProperty(
    "post.requestBody.content.application/json.schema.properties.info.$ref",
    "#/components/schemas/Session.Info",
  )
})
