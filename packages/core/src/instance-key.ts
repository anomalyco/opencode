export * as InstanceKey from "./instance-key.js"

import { Brand } from "effect"

/** Process-local instance identity, not a wire or storage contract. */
export type Key = string & Brand.Brand<"Instance.Key">
export const Key = Brand.nominal<Key>()
