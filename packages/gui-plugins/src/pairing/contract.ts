import { Schema } from "effect"
import { Ipc } from "@opencode/plugin/gui"

/**
 * Turns on remote access and keeps this machine's display awake while another device uses it. The window asks the
 * local server for its remote address and pairing codes through its own `ServerRef`; remote access, which changes
 * the background service's settings through the CLI, the display sleep blocker, and nearby pairing (announcing this
 * machine over mDNS and running the code exchange with a phone) need the main process.
 */
/**
 * A nearby phone asking to pair, with the code both screens show, until the pairing ends. `approved` once the user
 * chose Pair; `offers` the snoozes worth showing, only once requests have been busy.
 */
export const NearbyPrompt = Schema.Struct({
  id: Schema.String,
  device: Schema.String,
  code: Schema.String,
  approved: Schema.Boolean,
  offers: Schema.Struct({ device: Schema.Boolean, all: Schema.Boolean }),
})

export const Pairing = Ipc.define({
  id: "pairing",
  /** The nearby phone waiting for the user's answer, if any. */
  state: Schema.Struct({ nearby: Schema.NullOr(NearbyPrompt) }),
  methods: {
    /** Whether remote access is on: the background service serves an OpenTunnel address. */
    remote: { output: Schema.Boolean },
    /**
     * Turns remote access on or off, then starts the background service again. Turning it on the first time creates
     * the tunnel, which can take a minute.
     */
    setRemote: { input: Schema.Boolean },
    /** Whether main holds the display sleep blocker. */
    screenActive: { output: Schema.Boolean },
    /** Holds or releases the display sleep blocker, and remembers the choice. */
    setScreenActive: { input: Schema.Boolean },
    /** Whether nearby phones can find this machine, or null while the `nearby_pairing` flag is off. */
    discoverable: { output: Schema.NullOr(Schema.Boolean) },
    /** Starts or stops announcing this machine to nearby phones, and remembers the choice. */
    setDiscoverable: { input: Schema.Boolean },
    /** The user checked the codes match and pairs the phone with this id. An unknown id does nothing. */
    approveNearby: { input: Schema.String },
    /** The user declines the phone with this id. An unknown id does nothing. */
    cancelNearby: { input: Schema.String },
    /** Declines the phone with this id and refuses requests from that device, or from every device, for a while. */
    snoozeNearby: {
      input: Schema.Struct({ id: Schema.String, scope: Schema.Literals(["device", "all"]) }),
    },
  },
  events: {
    /** A pairing the user agreed to ended: the phone connected, or it failed. */
    nearbyResult: Schema.Struct({ device: Schema.String, paired: Schema.Boolean }),
  },
})
