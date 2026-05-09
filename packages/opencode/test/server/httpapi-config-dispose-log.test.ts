import { describe, expect, test } from "bun:test"
import path from "path"

// Hono and HTTP API both perform instance disposal as a side effect of
// PATCH /config (the request itself succeeds; the instance is then torn
// down so the new config takes effect). When that disposal throws, both
// backends must surface the failure to operators via log.warn — silent
// failures hide broken state behind a 200 response.
//
// Inducing a real disposal failure requires replacing InstanceStore
// inside the layered server context, which is invasive. This test
// verifies the catch-and-log wiring at the source level instead.
const repoRoot = path.resolve(import.meta.dir, "../..")
const honoConfigPath = path.join(repoRoot, "src/server/routes/instance/config.ts")
const lifecyclePath = path.join(repoRoot, "src/server/routes/instance/httpapi/lifecycle.ts")

const DISPOSAL_LOG_REGEX = /log\.(warn|error)\(\s*"instance disposal failed"/

describe("PATCH /config disposal error visibility", () => {
  test("Hono backend logs disposal failures", async () => {
    const source = await Bun.file(honoConfigPath).text()
    const patchIdx = source.indexOf(".patch(")
    expect(patchIdx).toBeGreaterThan(-1)
    const handlerRegion = source.slice(patchIdx)
    expect(handlerRegion).toContain("Effect.catchCause")
    expect(handlerRegion).toMatch(DISPOSAL_LOG_REGEX)
  })

  test("HTTP API backend logs disposal failures", async () => {
    const source = await Bun.file(lifecyclePath).text()
    expect(source).toMatch(/Effect\.catchCause/)
    expect(source).toMatch(DISPOSAL_LOG_REGEX)
  })
})
