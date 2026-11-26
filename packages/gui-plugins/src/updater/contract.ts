import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/** Desktop updater preferences stored in the main process so they apply before any window opens. */
export const UpdaterPreferences = Ipc.define({
  id: "updater.preferences",
  state: Schema.Struct({
    /** Whether a downloaded update installs automatically when the app quits. */
    installOnQuit: Schema.Boolean,
  }),
  methods: {
    /** Turns installing downloaded updates on quit on or off, and remembers the choice. */
    setInstallOnQuit: { input: Schema.Boolean },
  },
})
