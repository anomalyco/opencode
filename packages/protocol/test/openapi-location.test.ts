import { expect, test } from "bun:test"
import { OpenApi } from "effect/http-api"
import { ClientApi } from "../src/client.js"

type Parameter = {
  readonly name?: string
  readonly in?: string
  readonly style?: string
  readonly explode?: boolean
}
type Operation = {
  readonly parameters?: ReadonlyArray<Parameter>
}
const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const

test("every location query parameter declares deepObject style", () => {
  const missing = Object.entries(OpenApi.fromApi(ClientApi).paths).flatMap(([path, item]) =>
    methods.flatMap((method) => {
      const operation = (item as Record<string, Operation | undefined>)[method]
      if (!operation?.parameters) return []
      return operation.parameters
        .filter((parameter) => parameter.name === "location" && parameter.in === "query")
        .filter((parameter) => parameter.style !== "deepObject" || parameter.explode !== true)
        .map(() => `${method.toUpperCase()} ${path}`)
    }),
  )

  expect(missing).toEqual([])
})
