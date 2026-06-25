import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { provideTmpdirInstance, testInstanceStoreLayer, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Format } from "../../src/format"
import * as Formatter from "../../src/format/formatter"

const it = testEffect(Layer.mergeAll(Format.defaultLayer, CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer))

describe("Format", () => {
  it.instance("status() returns empty list when no formatters are configured", () =>
    Format.Service.use((fmt) =>
      Effect.gen(function* () {
        expect(yield* fmt.status()).toEqual([])
      }),
    ),
  )

  it.instance(
    "status() returns built-in formatters when formatter is true",
    () =>
      Format.Service.use((fmt) =>
        Effect.gen(function* () {
          const statuses = yield* fmt.status()
          const gofmt = statuses.find((item) => item.name === "gofmt")
          expect(gofmt).toBeDefined()
          expect(gofmt!.extensions).toContain(".go")
        }),
      ),
    { config: { formatter: true } },
  )

  it.instance(
    "status() keeps built-in formatters when config object is provided",
    () =>
      Format.Service.use((fmt) =>
        Effect.gen(function* () {
          const statuses = yield* fmt.status()
          const gofmt = statuses.find((item) => item.name === "gofmt")
          const mix = statuses.find((item) => item.name === "mix")
          expect(gofmt).toBeDefined()
          expect(gofmt!.extensions).toContain(".go")
          expect(mix).toBeDefined()
        }),
      ),
    { config: { formatter: { gofmt: {} } } },
  )

  it.instance(
    "status() excludes formatters marked as disabled in config",
    () =>
      Format.Service.use((fmt) =>
        Effect.gen(function* () {
          const statuses = yield* fmt.status()
          const gofmt = statuses.find((item) => item.name === "gofmt")
          const mix = statuses.find((item) => item.name === "mix")
          expect(gofmt).toBeUndefined()
          expect(mix).toBeDefined()
        }),
      ),
    { config: { formatter: { gofmt: { disabled: true } } } },
  )

  it.instance(
    "status() excludes uv when ruff is disabled",
    () =>
      Format.Service.use((fmt) =>
        Effect.gen(function* () {
          const statuses = yield* fmt.status()
          expect(statuses.find((item) => item.name === "ruff")).toBeUndefined()
          expect(statuses.find((item) => item.name === "uv")).toBeUndefined()
        }),
      ),
    { config: { formatter: { ruff: { disabled: true } } } },
  )

  it.instance(
    "status() excludes ruff when uv is disabled",
    () =>
      Format.Service.use((fmt) =>
        Effect.gen(function* () {
          const statuses = yield* fmt.status()
          expect(statuses.find((item) => item.name === "ruff")).toBeUndefined()
          expect(statuses.find((item) => item.name === "uv")).toBeUndefined()
        }),
      ),
    { config: { formatter: { uv: { disabled: true } } } },
  )

  it.instance("service initializes without error", () => Format.Service.use(() => Effect.void))

  it.instance(
    "file() returns false when no formatter runs",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const file = `${test.directory}/test.txt`
        yield* Effect.promise(() => Bun.write(file, "x"))

        const formatted = yield* Format.use.file(file)
        expect(formatted).toBe(false)
      }),
    { config: { formatter: false } },
  )

  testEffect(
    Layer.mergeAll(Format.defaultLayer, CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer, testInstanceStoreLayer),
  ).live("status() initializes formatter state per directory", () =>
    Effect.gen(function* () {
      const a = yield* provideTmpdirInstance(() => Format.use.status(), {
        config: { formatter: false },
      })
      const b = yield* provideTmpdirInstance(() => Format.use.status(), {
        config: {
          formatter: true,
        },
      })

      expect(a).toEqual([])
      expect(b.find((item) => item.name === "gofmt")).toBeDefined()
    }),
  )

  it.instance(
    "runs enabled checks for matching formatters in parallel",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const file = `${test.directory}/test.parallel`
        yield* Effect.promise(() => Bun.write(file, "x"))

        const one = {
          extensions: Formatter.gofmt.extensions,
          enabled: Formatter.gofmt.enabled,
        }
        const two = {
          extensions: Formatter.mix.extensions,
          enabled: Formatter.mix.enabled,
        }

        let active = 0
        let max = 0

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            Formatter.gofmt.extensions = [".parallel"]
            Formatter.mix.extensions = [".parallel"]
            Formatter.gofmt.enabled = async () => {
              active++
              max = Math.max(max, active)
              await Promise.resolve()
              active--
              return ["sh", "-c", "true"]
            }
            Formatter.mix.enabled = async () => {
              active++
              max = Math.max(max, active)
              await Promise.resolve()
              active--
              return ["sh", "-c", "true"]
            }
          }),
          () =>
            Format.Service.use((fmt) =>
              Effect.gen(function* () {
                yield* fmt.init()
                yield* fmt.file(file)
              }),
            ),
          () =>
            Effect.sync(() => {
              Formatter.gofmt.extensions = one.extensions
              Formatter.gofmt.enabled = one.enabled
              Formatter.mix.extensions = two.extensions
              Formatter.mix.enabled = two.enabled
            }),
        )

        expect(max).toBe(2)
      }),
    { config: { formatter: { gofmt: {}, mix: {} } } },
  )

  it.instance(
    "runs matching formatters sequentially for the same file",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const file = `${test.directory}/test.seq`
        yield* Effect.promise(() => Bun.write(file, "x"))

        yield* Format.Service.use((fmt) =>
          Effect.gen(function* () {
            yield* fmt.init()
            expect(yield* fmt.file(file)).toBe(true)
          }),
        )

        expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("xAB")
      }),
    {
      config: {
        formatter: {
          first: {
            command: [
              "node",
              "-e",
              "const fs = require('fs'); const file = process.argv[1]; fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + 'A')",
              "$FILE",
            ],
            extensions: [".seq"],
          },
          second: {
            command: [
              "node",
              "-e",
              "const fs = require('fs'); const file = process.argv[1]; fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + 'B')",
              "$FILE",
            ],
            extensions: [".seq"],
          },
        },
      },
    },
  )
})
