/** The rollover RPC contract (the goal plugin's pattern, spec §9). */
import { Schema } from "effect"

/**
 * The `/rollover` command's output channel. The command endpoint returns
 * NoContent on success and there is no success channel for command output, so
 * the text is published on `notify` and the plugin's GUI and TUI parts show it
 * as a toast. The command itself succeeds, so clients clear the composer and
 * raise no error toast. The `gui-experimental.cjs` bundle repeats this
 * definition as plain JSON Schema; keep the two in sync.
 */
export const RolloverDefinition = {
  id: "rollover",
  methods: {},
  events: {
    notify: {
      schema: Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Schema.String, text: Schema.String })),
    },
  },
}
