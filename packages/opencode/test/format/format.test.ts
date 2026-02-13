import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Format } from "../../src/format"
import type { DiffRange } from "../../src/format/diff-range"
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
      const b = yield* provideTmpdirInstance(() => Format.Service.use((fmt) => fmt.status()), {
        config: {
          formatter: true,
        },
      })

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

  it.live("passes ranges to buildRangeCommand and skips it when no ranges given", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = `${dir}/test.ranged`
        yield* Effect.promise(() => Bun.write(file, ""))

        const captured: DiffRange[][] = []
        const orig = {
          extensions: Formatter.gofmt.extensions,
          enabled: Formatter.gofmt.enabled,
          build: Formatter.gofmt.buildRangeCommand,
        }

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            Formatter.gofmt.extensions = [".ranged"]
            Formatter.gofmt.enabled = async () => ["sh", "-c", "true"]
            Formatter.gofmt.buildRangeCommand = (_file, _cmd, ranges) => {
              captured.push(ranges)
              return [["sh", "-c", "true"]]
            }
          }),
          () =>
            Format.Service.use((fmt) =>
              Effect.gen(function* () {
                const ranges: DiffRange[] = [
                  { start: 5, end: 15 },
                  { start: 30, end: 50 },
                ]

                yield* fmt.file(file, ranges)
                expect(captured.length).toBe(1)
                expect(captured[0]).toEqual(ranges)

                yield* fmt.file(file)
                // called without ranges — buildRangeCommand must not be invoked
                expect(captured.length).toBe(1)
              }),
            ),
          () =>
            Effect.sync(() => {
              Formatter.gofmt.extensions = orig.extensions
              Formatter.gofmt.enabled = orig.enabled
              Formatter.gofmt.buildRangeCommand = orig.build
            }),
        )
      }),
    ),
  )

  it.live("executes all commands returned by buildRangeCommand", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const file = `${dir}/test.multi`
        yield* Effect.promise(() => Bun.write(file, ""))

        const orig = {
          extensions: Formatter.gofmt.extensions,
          enabled: Formatter.gofmt.enabled,
          build: Formatter.gofmt.buildRangeCommand,
        }

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
            Formatter.gofmt.extensions = [".multi"]
            Formatter.gofmt.enabled = async () => ["sh", "-c", "true"]
            // Each command appends a marker so we can count actual executions
            Formatter.gofmt.buildRangeCommand = () => [
              ["sh", "-c", `printf A >> "${file}"`],
              ["sh", "-c", `printf B >> "${file}"`],
              ["sh", "-c", `printf C >> "${file}"`],
            ]
          }),
          () =>
            Format.Service.use((fmt) =>
              Effect.gen(function* () {
                const ranges: DiffRange[] = [{ start: 0, end: 10 }]
                yield* fmt.file(file, ranges)
                // All 3 commands must have executed, writing ABC
                const content = yield* Effect.promise(() => Bun.file(file).text())
                expect(content).toBe("ABC")
              }),
            ),
          () =>
            Effect.sync(() => {
              Formatter.gofmt.extensions = orig.extensions
              Formatter.gofmt.enabled = orig.enabled
              Formatter.gofmt.buildRangeCommand = orig.build
            }),
        )
      }),
    ),
  )
})
