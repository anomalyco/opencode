import { Schema } from "effect"
import { Ipc } from "../sdk"

/**
 * Captures memory for debugging leaks. Heap snapshots of the main process and every app window can only be taken
 * from main, and the desktop server's snapshot is moved next to them, so one folder holds the whole app.
 */
export const HeapSnapshots = Ipc.define({
  id: "debug.heap",
  methods: {
    /**
     * Writes heap snapshots of the desktop's own server, every app window and the main process into a new folder,
     * with a `manifest.json` written last. One capture runs at a time; a second call waits for the first. A snapshot
     * that fails is recorded in the manifest and the others are still written.
     */
    write: {
      output: Schema.Struct({
        /** The new folder. */
        directory: Schema.String,
        /** Whether every snapshot was written. */
        complete: Schema.Boolean,
      }),
    },
  },
})
