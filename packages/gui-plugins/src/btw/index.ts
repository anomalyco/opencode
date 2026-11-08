import { Schema } from "effect"
import { Plugin, Store } from "@opencode/plugin/gui"
import en from "./i18n/en"

const ChatModel = Schema.Struct({
  providerID: Schema.String,
  id: Schema.String,
  variant: Schema.optional(Schema.String),
})

const Chats = Schema.Struct({
  chats: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      question: Schema.String,
      answer: Schema.optional(Schema.String),
      agent: Schema.optional(Schema.String),
      model: Schema.optional(ChatModel),
      created: Schema.optional(Schema.Number),
      duration: Schema.optional(Schema.Number),
    }),
  ),
})

export default Plugin.define({
  stores: {
    // Each open /btw tab's chat (its question and answer), kept until its tab closes.
    chats: Store.session(Chats, { chats: [] }),
  },
  i18n: { en },
})
