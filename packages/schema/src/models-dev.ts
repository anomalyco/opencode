export * as ModelsDev from "./models-dev"

import { define } from "./event"

export const Event = {
  Refreshed: define({
    type: "models-dev.refreshed",
    schema: {},
  }),
}
