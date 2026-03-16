import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { withServices } from "../fixture/instance"
import { FormatService } from "../../src/format"
import { Instance } from "../../src/project/instance"

describe("FormatService", () => {
  afterEach(() => Instance.disposeAll())

  test("status() returns built-in formatters when no config overrides", async () => {
    await using tmp = await tmpdir()

    await withServices(tmp.path, FormatService.layer, async (rt) => {
      const statuses = await rt.runPromise(FormatService.use((s) => s.status()))
      expect(Array.isArray(statuses)).toBe(true)
      expect(statuses.length).toBeGreaterThan(0)

      for (const s of statuses) {
        expect(typeof s.name).toBe("string")
        expect(Array.isArray(s.extensions)).toBe(true)
        expect(typeof s.enabled).toBe("boolean")
      }

      const gofmt = statuses.find((s) => s.name === "gofmt")
      expect(gofmt).toBeDefined()
      expect(gofmt!.extensions).toContain(".go")
    })
  })

  test("status() returns empty list when formatter is disabled", async () => {
    await using tmp = await tmpdir({
      config: { formatter: false },
    })

    await withServices(tmp.path, FormatService.layer, async (rt) => {
      const statuses = await rt.runPromise(FormatService.use((s) => s.status()))
      expect(statuses).toEqual([])
    })
  })

  test("status() excludes formatters marked as disabled in config", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: {
          gofmt: { disabled: true },
        },
      },
    })

    await withServices(tmp.path, FormatService.layer, async (rt) => {
      const statuses = await rt.runPromise(FormatService.use((s) => s.status()))
      const gofmt = statuses.find((s) => s.name === "gofmt")
      expect(gofmt).toBeUndefined()
    })
  })

  test("init() completes without error", async () => {
    await using tmp = await tmpdir()

    await withServices(tmp.path, FormatService.layer, async (rt) => {
      await rt.runPromise(FormatService.use((s) => s.init()))
    })
  })
})
