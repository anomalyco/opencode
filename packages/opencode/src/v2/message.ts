import { Identifier } from "@/id/id"
import { withStatics } from "@/util/schema"
import { DateTime, Effect, Schema } from "effect"

export namespace Message {
  export const ID = Schema.String.pipe(Schema.brand("Message.ID")).pipe(
    withStatics((s) => ({
      create: () => s.make(Identifier.ascending("message")),
      prefix: "msg",
    })),
  )

  export class Source extends Schema.Class<Source>("Message.Source")({
    start: Schema.Number,
    end: Schema.Number,
    text: Schema.String,
  }) {}

  export class FileAttachment extends Schema.Class<FileAttachment>("Message.File.Attachment")({
    uri: Schema.String,
    mime: Schema.String,
    name: Schema.String.pipe(Schema.optional),
    description: Schema.String.pipe(Schema.optional),
    source: Source.pipe(Schema.optional),
  }) {
    static create(url: string) {
      return new FileAttachment({
        uri: url,
        mime: "text/plain",
      })
    }
  }

  export class AgentAttachment extends Schema.Class<AgentAttachment>("Message.Agent.Attachment")({
    name: Schema.String,
    source: Source.pipe(Schema.optional),
  }) {}

  export class User extends Schema.Class<User>("Message.User")({
    id: ID,
    type: Schema.Literal("user"),
    text: Schema.String,
    files: Schema.Array(FileAttachment).pipe(Schema.optional),
    agents: Schema.Array(AgentAttachment).pipe(Schema.optional),
    time: Schema.Struct({
      created: Schema.DateTimeUtc,
    }),
  }) {
    static create(input: { text: User["text"]; files?: User["files"]; agents?: User["agents"] }) {
      const msg = new User({
        id: ID.create(),
        type: "user",
        ...input,
        time: {
          created: Effect.runSync(DateTime.now),
        },
      })
      return msg
    }
  }

  export class Synthetic extends Schema.Class<Synthetic>("Message.Synthetic")({
    id: ID,
    type: Schema.Literal("synthetic"),
    text: Schema.String,
    time: Schema.Struct({
      created: Schema.DateTimeUtc,
    }),
  }) {}

  export class Request extends Schema.Class<Request>("Message.Request")({
    id: ID,
    type: Schema.Literal("start"),
    model: Schema.Struct({
      id: Schema.String,
      providerID: Schema.String,
      variant: Schema.String.pipe(Schema.optional),
    }),
    time: Schema.Struct({
      created: Schema.DateTimeUtc,
    }),
  }) {}

  export class Text extends Schema.Class<Text>("Message.Text")({
    id: ID,
    type: Schema.Literal("text"),
    text: Schema.String,
    time: Schema.Struct({
      created: Schema.DateTimeUtc,
      completed: Schema.DateTimeUtc.pipe(Schema.optional),
    }),
  }) {}

  export class Complete extends Schema.Class<Complete>("Message.Complete")({
    id: ID,
    type: Schema.Literal("complete"),
    time: Schema.Struct({
      created: Schema.DateTimeUtc,
    }),
    cost: Schema.Number,
    tokens: Schema.Struct({
      total: Schema.Number,
      input: Schema.Number,
      output: Schema.Number,
      reasoning: Schema.Number,
      cache: Schema.Struct({
        read: Schema.Number,
        write: Schema.Number,
      }),
    }),
  }) {}

  export const Info = Schema.Union([User, Text])
  export type Info = Schema.Schema.Type<typeof Info>
}
