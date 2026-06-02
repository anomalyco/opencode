import { Schema } from "effect"
import { BusEvent } from "@/bus/bus-event"

export const BrowserSessionStarted = BusEvent.define("browser.session.started", Schema.Struct({
  sessionID: Schema.String,
}))

export const BrowserSessionClosed = BusEvent.define("browser.session.closed", Schema.Struct({
  sessionID: Schema.String,
}))

export const BrowserAction = BusEvent.define("browser.action", Schema.Struct({
  sessionID: Schema.String,
  action: Schema.String,
  url: Schema.optional(Schema.String),
}))

export * as BrowserBusEvents from "./bus-events"
