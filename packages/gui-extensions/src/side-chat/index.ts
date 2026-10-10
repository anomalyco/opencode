import { Schema } from "effect"
import { Extension, Store } from "../sdk"
import en from "./i18n/en"

const Chats = Schema.Struct({
  chats: Schema.Array(
    Schema.Struct({
      // The tab id.
      id: Schema.String,
      // The number in the tab's title; the lowest one no open chat uses.
      ordinal: Schema.Number,
      // The child session forked from the main one.
      sessionID: Schema.String,
      // The last message the fork inherited; everything up to it stays out of the chat's transcript.
      base: Schema.String,
    }),
  ),
})

export default Extension.define({
  id: "side-chat",
  stores: {
    // Each open side chat, kept until its tab closes.
    chats: Store.session(Chats, { chats: [] }),
  },
  i18n: { en },
})
