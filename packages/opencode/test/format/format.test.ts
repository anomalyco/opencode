import { Effect } from "effect"
import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { withServices } from "../fixture/instance"
import { Bus } from "../../src/bus"
import { File } from "../../src/file"
import { Format } from "../../src/format"
import * as Formatter from "../../src/format/formatter"
import { Instance } from "../../src/project/instance"

describe("Format", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("status() returns built-in formatters when no config overrides", async () => {
    await using tmp = await tmpdir()

    await withServices(tmp.path, Format.layer, async (rt) => {
      const statuses = await rt.runPromise(Format.Service.use((s) => s.status()))
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

    await withServices(tmp.path, Format.layer, async (rt) => {
      const statuses = await rt.runPromise(Format.Service.use((s) => s.status()))
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

    await withServices(tmp.path, Format.layer, async (rt) => {
      const statuses = await rt.runPromise(Format.Service.use((s) => s.status()))
      const gofmt = statuses.find((s) => s.name === "gofmt")
      expect(gofmt).toBeUndefined()
    })
  })

  test("service initializes without error", async () => {
    await using tmp = await tmpdir()

    await withServices(tmp.path, Format.layer, async (rt) => {
      await rt.runPromise(Format.Service.use(() => Effect.void))
    })
  })

  test("status() initializes formatter state per directory", async () => {
    await using off = await tmpdir({
      config: { formatter: false },
    })
    await using on = await tmpdir()

    const a = await Instance.provide({
      directory: off.path,
      fn: () => Format.status(),
    })
    const b = await Instance.provide({
      directory: on.path,
      fn: () => Format.status(),
    })

    expect(a).toEqual([])
    expect(b.length).toBeGreaterThan(0)
  })

  test("runs enabled checks for matching formatters in parallel", async () => {
    await using tmp = await tmpdir()

    const file = `${tmp.path}/test.parallel`
    await Bun.write(file, "x")

    const one = {
      extensions: Formatter.gofmt.extensions,
      enabled: Formatter.gofmt.enabled,
      command: Formatter.gofmt.command,
    }
    const two = {
      extensions: Formatter.mix.extensions,
      enabled: Formatter.mix.enabled,
      command: Formatter.mix.command,
    }

    let active = 0
    let max = 0

    Formatter.gofmt.extensions = [".parallel"]
    Formatter.mix.extensions = [".parallel"]
    Formatter.gofmt.command = ["sh", "-c", "true"]
    Formatter.mix.command = ["sh", "-c", "true"]
    Formatter.gofmt.enabled = async () => {
      active++
      max = Math.max(max, active)
      await Bun.sleep(20)
      active--
      return true
    }
    Formatter.mix.enabled = async () => {
      active++
      max = Math.max(max, active)
      await Bun.sleep(20)
      active--
      return true
    }

    try {
      await withServices(tmp.path, Format.layer, async (rt) => {
        await rt.runPromise(Format.Service.use((s) => s.init()))
        await Bus.publish(File.Event.Edited, { file })
      })
    } finally {
      Formatter.gofmt.extensions = one.extensions
      Formatter.gofmt.enabled = one.enabled
      Formatter.gofmt.command = one.command
      Formatter.mix.extensions = two.extensions
      Formatter.mix.enabled = two.enabled
      Formatter.mix.command = two.command
    }

    expect(max).toBe(2)
  })

  test("runs matching formatters sequentially for the same file", async () => {
    await using tmp = await tmpdir({
      config: {
        formatter: {
          first: {
            command: ["sh", "-c", 'sleep 0.05; v=$(cat "$1"); printf \'%sA\' "$v" > "$1"', "sh", "$FILE"],
            extensions: [".seq"],
          },
          second: {
            command: ["sh", "-c", 'v=$(cat "$1"); printf \'%sB\' "$v" > "$1"', "sh", "$FILE"],
            extensions: [".seq"],
          },
        },
      },
    })

    const file = `${tmp.path}/test.seq`
    await Bun.write(file, "x")

    await withServices(tmp.path, Format.layer, async (rt) => {
      await rt.runPromise(Format.Service.use((s) => s.init()))
      await Bus.publish(File.Event.Edited, { file })
    })

    expect(await Bun.file(file).text()).toBe("xAB")
  })
})
