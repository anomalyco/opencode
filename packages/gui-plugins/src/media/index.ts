import { Schema } from "effect"
import { Plugin, Store } from "@opencode/plugin/gui"
import en from "./i18n/en"

const View = Schema.Struct({
  kind: Schema.Literals(["media", "links"]),
  from: Schema.Literals(["all", "user", "agent"]),
})

export default Plugin.define({
  stores: {
    // What the session's panel shows, so it comes back the same after its tab closes or the app restarts.
    view: Store.session(View, { kind: "media", from: "all" }),
  },
  i18n: { en },
})
