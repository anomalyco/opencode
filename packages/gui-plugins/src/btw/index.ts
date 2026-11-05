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
      // A side chat follow-up names its thread's first question, which keeps the count shared with the agent.
      thread: Schema.optional(Schema.String),
      shared: Schema.optional(Schema.Number),
      // A note the side model passed to the agent on its own, and the inbox item that carries it until delivery.
      note: Schema.optional(
        Schema.Struct({
          text: Schema.String,
          inboxID: Schema.optional(Schema.String),
          failed: Schema.optional(Schema.Boolean),
          undone: Schema.optional(Schema.Boolean),
        }),
      ),
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
    // Each open /btw tab's chat (its question and answer, and with side_chat its follow-ups), kept until its tab closes.
    chats: Store.session(Chats, { chats: [] }),
  },
  i18n: { en },
})
