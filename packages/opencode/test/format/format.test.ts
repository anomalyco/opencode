import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Format } from "../../src/format"
import * as Formatter from "../../src/format/formatter"

const it = testEffect(Layer.mergeAll(Format.defaultLayer, CrossSpawnSpawner.defaultLayer, NodeFileSystem.layer))

describe("Format", () => {
  it.live("status() returns empty list when no formatters are configured", () =>
    provideTmpdirInstance(() =>
      Format.Service.use((fmt) =>
        Effect.gen(function* () {
          expect(yield* fmt.status()).toEqual([])
        }),
      ),
    ),
  )

  it.live("status() returns built-in formatters when formatter is true", () =>
    provideTmpdirInstance(
      () =>
        Format.Service.use((fmt) =>
          Effect.gen(function* () {
            const statuses = yield* fmt.status()
            const gofmt = statuses.find((item) => item.name === "gofmt")
            expect(gofmt).toBeDefined()
            expect(gofmt!.extensions).toContain(".go")
          }),
        ),
      {
        config: {
          formatter: true,
        },
      },
    ),
  )

  it.live("status() keeps built-in formatters when config object is provided", () =>
    provideTmpdirInstance(
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
      {
        config: {
          formatter: {
            gofmt: {},
          },
        },
      },
    ),
  )

  it.live("status() excludes formatters marked as disabled in config", () =>
    provideTmpdirInstance(
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
      {
        config: {
          formatter: {
            gofmt: { disabled: true },
          },
        },
      },
    ),
  )

  it.live("status() excludes uv when ruff is disabled", () =>
    provideTmpdirInstance(
      () =>
        Format.Service.use((fmt) =>
          Effect.gen(function* () {
            const statuses = yield* fmt.status()
            expect(statuses.find((item) => item.name === "ruff")).toBeUndefined()
            expect(statuses.find((item) => item.name === "uv")).toBeUndefined()
          }),
        ),
      {
        config: {
          formatter: {
            ruff: { disabled: true },
          },
        },
      },
    ),
  )

  it.live("status() excludes ruff when uv is disabled", () =>
    provideTmpdirInstance(
      () =>
        Format.Service.use((fmt) =>
          Effect.gen(function* () {
            const statuses = yield* fmt.status()
            expect(statuses.find((item) => item.name === "ruff")).toBeUndefined()
            expect(statuses.find((item) => item.name === "uv")).toBeUndefined()
          }),
        ),
      {
        config: {
          formatter: {
            uv: { disabled: true },
          },
        },
      },
    ),
  )

  it.live("service initializes without error", () => provideTmpdirInstance(() => Format.Service.use(() => Effect.void)))

  it.live("status() initializes formatter state per directory", () =>
    Effect.gen(function* () {
      const a = yield* provideTmpdirInstance(() => Format.Service.use((fmt) => fmt.status()), {
        config: { formatter: false },
      })
      const b = yield* provideTmpdirInstance(
        () => Format.Service.use((fmt) => fmt.status()),
        {
          config: {
            formatter: true,
          },
        },
      )

      expect(a).toEqual([])
      expect(b.find((item) => item.name === "gofmt")).toBeDefined()
    }),
  )

  it.live("runs enabled checks for matching formatters in parallel", () =>
    provideTmpdirInstance(
      (path) =>
        Effect.gen(function* () {
          const file = `${path}/test.parallel`
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
                await Bun.sleep(20)
                active--
                return ["sh", "-c", "true"]
              }
              Formatter.mix.enabled = async () => {
                active++
                max = Math.max(max, active)
                await Bun.sleep(20)
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
      {
        config: {
          formatter: {
            gofmt: {},
            mix: {},
          },
        },
      },
    ),
  )

  it.live("runs matching formatters sequentially for the same file", () =>
    provideTmpdirInstance(
      (path) =>
        Effect.gen(function* () {
          const file = `${path}/test.seq`
          yield* Effect.promise(() => Bun.write(file, "x"))

          yield* Format.Service.use((fmt) =>
            Effect.gen(function* () {
              yield* fmt.init()
              yield* fmt.file(file)
            }),
          )

          expect(yield* Effect.promise(() => Bun.file(file).text())).toBe("xAB")
        }),
      {
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
      },
    ),
  )
})
