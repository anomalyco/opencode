export * as ConfigFileTree from "./file-tree.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../schema.js"

export class Info extends Schema.Class<Info>("Config.FileTree")({
  refresh_concurrency: PositiveInt.pipe(optional).annotate({
    description:
      "How many directories the Files tree refresh button reloads at once (default: 4). The app's shared request queue has four slots, so larger values do not increase transport parallelism",
  }),
}) {}
