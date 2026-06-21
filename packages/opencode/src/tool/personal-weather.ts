import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-weather.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("current", "forecast"),
  latitude: Schema.optional(Schema.Number),
  longitude: Schema.optional(Schema.Number),
  city: Schema.optional(Schema.String),
  days: Schema.optional(Schema.Number),
})

export const PersonalWeatherTool = Tool.define(
  "personal_weather",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { Weather } = yield* Effect.promise(() => import("@opencode-ai/core/personal/weather"))
          const svc = yield* Weather

          switch (params.action) {
            case "current": {
              const result = yield* svc.getCurrent(params.latitude, params.longitude, params.city)
              return {
                title: `Clima atual${params.city ? ` em ${params.city}` : ""}`,
                output: JSON.stringify(result, null, 2),
              }
            }
            case "forecast": {
              const result = yield* svc.getForecast(params.latitude, params.longitude, params.days ?? 5)
              return {
                title: `Previsão do tempo${params.city ? ` para ${params.city}` : ""}`,
                output: JSON.stringify(result, null, 2),
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
