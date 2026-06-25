import { describe, expect } from "bun:test"
import { Config, ConfigProvider, Context, Effect, Layer, Option } from "effect"
import { ConfigService } from "../../src/effect/config-service"
import { it } from "../lib/effect"

class TestConfig extends ConfigService.Service<TestConfig>()("@test/ConfigService", {
  name: Config.string("NAME"),
  token: Config.string("TOKEN").pipe(Config.option),
  port: Config.number("PORT").pipe(Config.withDefault(3000)),
}) {}

const fromConfig = (input: Record<string, unknown>) =>
  TestConfig.defaultLayer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input))))

const readConfig = TestConfig.useSync((config) => config)

describe("ConfigService", () => {
  it.effect("defaultLayer parses values from the active ConfigProvider", () =>
    Effect.gen(function* () {
      const config = yield* readConfig.pipe(
        Effect.provide(
          fromConfig({
            NAME: "kit",
            TOKEN: "secret",
            PORT: "4096",
          }),
        ),
      )

      expect(config.name).toBe("kit")
      expect(config.token).toEqual(Option.some("secret"))
      expect(config.port).toBe(4096)
    }),
  )

  it.effect("defaultLayer applies Effect Config defaults", () =>
    Effect.gen(function* () {
      const config = yield* readConfig.pipe(Effect.provide(fromConfig({ NAME: "kit" })))

      expect(config.name).toBe("kit")
      expect(config.token).toEqual(Option.none())
      expect(config.port).toBe(3000)
    }),
  )

  it.effect("layer provides an already parsed service value", () =>
    Effect.gen(function* () {
      const config = yield* readConfig.pipe(
        Effect.provide(
          TestConfig.layer({
            name: "direct",
            token: Option.some("parsed"),
            port: 9000,
          }),
        ),
      )

      expect(config).toEqual({
        name: "direct",
        token: Option.some("parsed"),
        port: 9000,
      } satisfies Context.Service.Shape<typeof TestConfig>)
    }),
  )
})
