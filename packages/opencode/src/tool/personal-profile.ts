import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-profile.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literal("get", "update", "add_fact"),
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  timezone: Schema.optional(Schema.String),
  preferences: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  bio: Schema.optional(Schema.String),
  fact: Schema.optional(Schema.String),
})

export const PersonalProfileTool = Tool.define(
  "personal_profile",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { UserProfile } = yield* Effect.promise(() => import("@opencode-ai/core/personal/profile"))
          const userProfile = yield* UserProfile

          switch (params.action) {
            case "get": {
              const profile = yield* userProfile.get()
              return { title: "Perfil do usuário", output: JSON.stringify(profile, null, 2) }
            }
            case "update": {
              const profile = yield* userProfile.update({
                name: params.name,
                email: params.email,
                timezone: params.timezone,
                preferences: params.preferences,
                bio: params.bio,
              })
              return { title: "Perfil atualizado", output: JSON.stringify(profile, null, 2) }
            }
            case "add_fact": {
              if (!params.fact) return yield* Effect.fail(new Error("fact is required for add_fact action"))
              const profile = yield* userProfile.addFact(params.fact)
              return { title: "Fato adicionado", output: JSON.stringify(profile, null, 2) }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
