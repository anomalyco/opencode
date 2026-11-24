export * as ConfigPush from "./push.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

export class Info extends Schema.Class<Info>("ConfigPush.Info")({
  relays: Schema.Array(Schema.String).pipe(optional).annotate({
    description:
      "Extra notification relay origins phones may register with, added to the production relay, such as https://notify.dev.opencode.ai",
  }),
}) {}
