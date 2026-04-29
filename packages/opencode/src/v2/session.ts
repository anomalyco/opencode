import { Context, Layer, Schema, Effect } from "effect"
import { SessionEntry } from "./session-entry"
import { Struct } from "effect"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"

export const ID = SessionID

export type ID = Schema.Schema.Type<typeof ID>

export class PromptInput extends Schema.Class<PromptInput>("Session.PromptInput")({
  ...Struct.omit(SessionEntry.User.fields, ["time", "type"]),
  id: Schema.optionalKey(SessionEntry.ID),
  sessionID: ID,
}) {}

export class CreateInput extends Schema.Class<CreateInput>("Session.CreateInput")({
  id: Schema.optionalKey(ID),
}) {}

export class Info extends Schema.Class<Info>("Session.Info")({
  id: ID,
  model: Schema.Struct({
    id: Schema.String,
    providerID: Schema.String,
    modelID: Schema.String,
  }).pipe(Schema.optional),
}) {}

export interface Interface {
  fromID: (id: ID) => Effect.Effect<Info>
  create: (input: CreateInput) => Effect.Effect<Info>
  prompt: (input: PromptInput) => Effect.Effect<SessionEntry.User>
}

export class Service extends Context.Service<Service, Interface>()("Session.Service") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const session = yield* Session.Service

    const create: Interface["create"] = Effect.fn("Session.create")(function* (_input) {
      throw new Error("Not implemented")
    })

    const prompt: Interface["prompt"] = Effect.fn("Session.prompt")(function* (_input) {
      throw new Error("Not implemented")
    })

    const fromID: Interface["fromID"] = Effect.fn("Session.fromID")(function* (id) {
      const match = yield* session.get(id)
      return fromV1(match)
    })

    return Service.of({
      create,
      prompt,
      fromID,
    })
  }),
)

function fromV1(input: Session.Info): Info {
  return new Info({
    id: ID.make(input.id),
  })
}

export * as SessionV2 from "./session"
