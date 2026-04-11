import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
})

describe("abort session resilience", () => {
  test("abort route cancels in background and returns success immediately", async () => {
    const src = await Bun.file(new URL("../../src/server/instance/session.ts", import.meta.url)).text()
    const start = src.indexOf('"/:sessionID/abort"')
    const end = src.indexOf('"/:sessionID/share"', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const route = src.slice(start, end)
    expect(route).toContain("Instance.bind(() => {")
    expect(route).toContain(".catch(")
    expect(route).toContain("() => undefined")
    expect(route).toContain("return c.json(true)")
    expect(route).not.toContain("await AppRuntime.runPromise")
  })
})
