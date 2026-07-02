export * as ModelsDev from "./models-dev.js"

import { define, inventory } from "./event.js"

const Refreshed = define({
  type: "models-dev.refreshed",
  schema: {},
})
export const Event = { Refreshed, Definitions: inventory(Refreshed) }
