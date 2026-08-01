export * as InstallationEvent from "./installation-event"

import { Schema } from "effect"
import { Event } from "./event"

export const Updated = Event.define({
  type: "installation.updated",
  schema: {
    version: Schema.String,
  },
})

export const UpdateAvailable = Event.define({
  type: "installation.update-available",
  schema: {
    version: Schema.String,
  },
})

export const RebaseCheckReady = Event.define({
  type: "installation.rebase-check-ready",
  schema: {
    status: Schema.Literals(["clean", "conflicts", "type-errors"]),
    version: Schema.String,
    conflictingFiles: Schema.Array(Schema.String).pipe(Schema.optional),
    typeErrors: Schema.Array(Schema.String).pipe(Schema.optional),
  },
})

export const Definitions = Event.inventory(Updated, UpdateAvailable, RebaseCheckReady)
