import { Effect } from "effect"
import { define } from "../internal"

export const HuaweiPlugin = define({
  id: "huawei",
  effect: Effect.fn(function* () {
    // Huawei Cloud MaaS uses OpenAI-compatible native routes.
    // No AISDK package needed.
  }),
})
