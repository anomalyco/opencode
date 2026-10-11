import { Schema } from "effect"
import { Ipc } from "../sdk"

/**
 * Keeps this machine's display awake while another device uses it. The window asks the local server for addresses and
 * pairing codes through its own `ServerRef`; only the display sleep blocker needs the main process.
 */
export const Pairing = Ipc.define({
  id: "pairing",
  methods: {
    /** Whether main holds the display sleep blocker. */
    screenActive: { output: Schema.Boolean },
    /** Holds or releases the display sleep blocker, and remembers the choice. */
    setScreenActive: { input: Schema.Boolean },
  },
})
