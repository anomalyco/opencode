import { performance } from "perf_hooks"
import type { CliRenderer } from "@opentui/core"

// One physical keypress can occasionally surface as two identical key events
// from the stdin layer; specific terminal emulator versions and the Bun/Node
// event loop have both been at fault for this class of bug (opencode issue
// #4920). The duplicate arrives within a few milliseconds of the original —
// faster than OS key auto-repeat (no mainstream platform repeats under ~15ms,
// and kitty-protocol repeats carry a different raw sequence anyway) and faster
// than any human double press.
//
// The guard only drops a duplicate when both it and the event it copies were
// lone events of their own reads — the shape of a real isolated press.
// Anything that streams across reads — unbracketed pastes, tmux send-keys,
// SSH and automation — arrives as multi-event reads or back-to-back identical
// reads, and those sequences are kept.

const DUPLICATE_WINDOW_MS = 6

// Dispatched raw sequences can also be terminal responses and mouse reports,
// which share the same dispatch and may legitimately repeat. Kitty key events
// end in "u", "~" or an uppercase letter, so none of these final bytes or
// reply prefixes collide with a key: CPR/DA1/DSR/pixel replies ("R", "c", "n",
// "t" finals), SGR mouse reports ("<" prefix, "M"/"m" finals), and OSC, DCS or
// APC replies (theme-color probe, XTVERSION, kitty image ACK).
function isKeyShaped(sequence: string) {
  if (sequence.startsWith("\x1b]")) return false
  if (sequence.startsWith("\x1bP")) return false
  if (sequence.startsWith("\x1b_")) return false
  if (sequence.startsWith("\x1b[<")) return false
  return !/^\x1b\[[?<0-9;:]*[RcnMmt]$/.test(sequence)
}

export function createDuplicateKeyGuard(): (sequence: string) => boolean {
  let lastSequence: string | undefined
  let lastAcceptedAt = 0
  let previousReadEvents = 0
  let currentReadEvents = 0
  let snapshotQueued = false

  const scheduleSnapshot = () => {
    if (snapshotQueued) return
    snapshotQueued = true
    queueMicrotask(() => {
      snapshotQueued = false
      previousReadEvents = currentReadEvents
      currentReadEvents = 0
    })
  }

  return (sequence) => {
    if (!isKeyShaped(sequence)) return false
    currentReadEvents += 1
    scheduleSnapshot()

    const at = performance.now()
    if (
      previousReadEvents === 1 &&
      currentReadEvents === 1 &&
      sequence === lastSequence &&
      at - lastAcceptedAt < DUPLICATE_WINDOW_MS
    ) {
      // Anchor on the original event so a further lone duplicate from the same
      // press is dropped too.
      return true
    }

    lastSequence = sequence
    lastAcceptedAt = at
    return false
  }
}

export function registerDuplicateKeyGuard(renderer: CliRenderer) {
  if (process.env.OPENCODE_DISABLE_KEY_DEDUPE) return
  renderer.prependInputHandler(createDuplicateKeyGuard())
}
