import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/** Desktop updater preferences stored in the main process so they apply before any window opens. */
export const UpdaterPreferences = Ipc.define({
  id: "updater.preferences",
  state: Schema.Struct({
    /** Whether a downloaded update installs automatically when the app quits. */
    installOnQuit: Schema.Boolean,
    /**
     * macOS only: true when Squirrel.Mac has already staged an update for this quit, which cannot be disarmed
     * mid-session if the user later turns install-on-quit off. Always false on Windows and Linux.
     */
    pendingQuitInstall: Schema.Boolean,
  }),
  methods: {
    /** Turns installing downloaded updates on quit on or off, and remembers the choice. */
    setInstallOnQuit: { input: Schema.Boolean },
  },
})
