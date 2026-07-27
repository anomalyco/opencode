import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "../../src/server/routes/instance/httpapi/public"

describe("workflow answer route", () => {
  test("POST /workflow/run/{id}/answer is registered", () => {
    // The instance workflow group registers under the unprefixed surface (the
    // /api/* paths in the same spec are the separate v2 built-in routes), so the
    // route key is /workflow/run/{id}/answer — not /api/... .
    const spec = OpenApi.fromApi(PublicApi) as { paths: Record<string, Record<string, unknown>> }
    const item = spec.paths["/workflow/run/{id}/answer"]
    expect(item).toBeDefined()
    expect(item.post).toBeDefined()
  })
})
