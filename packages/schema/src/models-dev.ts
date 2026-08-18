export * as ModelsDev from "./models-dev"

import { define, inventory } from "./event"

const Refreshed = define({
  type: "models-dev.refreshed",
  schema: {},
})
export const Event = { Refreshed, Definitions: inventory(Refreshed) }
