import { Schema } from "effect"
import { Remote } from "../sdk"

export const UpdaterState = Schema.Union([
  Schema.Struct({ status: Schema.Literal("disabled") }),
  Schema.Struct({ status: Schema.Literal("idle") }),
  Schema.Struct({ status: Schema.Literal("checking") }),
  Schema.Struct({ status: Schema.Literal("downloading"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("ready"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("download-required"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("up-to-date") }),
  Schema.Struct({ status: Schema.Literal("installing"), version: Schema.String }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
])
export type UpdaterState = typeof UpdaterState.Type

/** The desktop app updater. Its state is app-wide; every window receives the same value. */
export const Updater = Remote.define({
  id: "updater",
  state: UpdaterState,
  methods: {
    check: { output: UpdaterState },
    /** Restarts into a staged update, or opens the installer download. */
    install: {},
  },
  events: {
    /** The app menu asks the focused window to check with in-app feedback (beta builds). */
    check: Schema.Null,
  },
})
