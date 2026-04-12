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

  export class File extends Schema.Class<File>("Message.File")({
    url: Schema.String,
    mime: Schema.String,
  }) {
    static create(url: string) {
      return new File({
        url,
        mime: "text/plain",
      })
    }
  }

  export class UserContent extends Schema.Class<UserContent>("Message.User.Content")({
    text: Schema.String,
    synthetic: Schema.Boolean.pipe(Schema.optional),
    agent: Schema.String.pipe(Schema.optional),
    files: Schema.Array(File).pipe(Schema.optional),
  }) {}

  export class User extends Schema.Class<User>("Message.User")({
    id: ID,
    type: Schema.Literal("user"),
    time: Schema.Struct({
      created: Schema.DateTimeUtc,
    }),
    content: UserContent,
  }) {
    static create(content: Schema.Schema.Type<typeof UserContent>) {
      const msg = new User({
        id: ID.create(),
        type: "user",
        time: {
          created: Effect.runSync(DateTime.now),
        },
        content,
      })
      return msg
    }

    static file(url: string) {
      return new File({
        url,
        mime: "text/plain",
      })
    }
  }

  export namespace User {}
}

const msg = Message.User.create({
  text: "Hello world",
  files: [Message.File.create("file://example.com/file.txt")],
})

console.log(JSON.stringify(msg, null, 2))
