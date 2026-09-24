import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { PublicApi } from "@/server/routes/instance/httpapi/public"

describe("remote public api", () => {
  test("keeps the desktop remote protocol out of public OpenAPI", () => {
    const spec = OpenApi.fromApi(PublicApi) as { paths?: Record<string, unknown> }
    const paths = Object.keys(spec.paths ?? {})

    expect(paths).not.toContain("/remote/pair")
    expect(paths).not.toContain("/remote/session/{sessionID}")
    expect(paths).not.toContain("/session/{sessionID}/remote")
  })
})
