export * as SessionDelivery from "./session-delivery"

import { Schema } from "effect"

export const Delivery = Schema.Literals(["steer", "queue"])
export type Delivery = typeof Delivery.Type
