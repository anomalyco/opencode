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
  it.live("status() returns built-in formatters when no config overrides", () =>
    provideTmpdirInstance(() =>
      Format.Service.use((fmt) =>
        Effect.gen(function* () {
          const statuses = yield* fmt.status()
          expect(Array.isArray(statuses)).toBe(true)
          expect(statuses.length).toBeGreaterThan(0)

          for (const item of statuses) {
            expect(typeof item.name).toBe("string")
            expect(Array.isArray(item.extensions)).toBe(true)
            expect(typeof item.enabled).toBe("boolean")
          }

          const gofmt = statuses.find((item) => item.name === "gofmt")
          expect(gofmt).toBeDefined()
          expect(gofmt!.extensions).toContain(".go")
        }),
      ),
    ),
  )

  it.live("status() returns empty list when formatter is disabled", () =>
    provideTmpdirInstance(
      () =>
        Format.Service.use((fmt) =>
          Effect.gen(function* () {
            expect(yield* fmt.status()).toEqual([])
          }),
        ),
      { config: { formatter: false } },
    ),
  )

  it.live("status() excludes formatters marked as disabled in config", () =>
    provideTmpdirInstance(
      () =>
        Format.Service.use((fmt) =>
          Effect.gen(function* () {
            const statuses = yield* fmt.status()
            const gofmt = statuses.find((item) => item.name === "gofmt")
            expect(gofmt).toBeUndefined()
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

  it.live("service initializes without error", () => provideTmpdirInstance(() => Format.Service.use(() => Effect.void)))

  it.live("status() initializes formatter state per directory", () =>
    Effect.gen(function* () {
      const a = yield* provideTmpdirInstance(() => Format.Service.use((fmt) => fmt.status()), {
        config: { formatter: false },
      })
      const b = yield* provideTmpdirInstance(() => Format.Service.use((fmt) => fmt.status()))

      expect(a).toEqual([])
      expect(b.length).toBeGreaterThan(0)
    }),
  )

  it.live("runs enabled checks for matching formatters in parallel", () =>
    provideTmpdirInstance((path) =>
      Effect.gen(function* () {
        const file = `${path}/test.parallel`
        yield* Effect.promise(() => Bun.write(file, "x"))

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

        yield* Effect.acquireUseRelease(
          Effect.sync(() => {
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
              Formatter.gofmt.command = one.command
              Formatter.mix.extensions = two.extensions
              Formatter.mix.enabled = two.enabled
              Formatter.mix.command = two.command
            }),
        )

        expect(max).toBe(2)
      }),
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
