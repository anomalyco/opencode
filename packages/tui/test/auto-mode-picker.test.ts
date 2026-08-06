// The auto-mode indicator is two independent booleans presented as four named
// states. Getting that mapping wrong means the pill lies about what the agent
// will do — which is worse than having no indicator.
import { describe, expect, test } from "bun:test"
import { currentAutoMode } from "../src/component/dialog-auto-mode"
import { MODES } from "../src/util/auto-mode"

describe("currentAutoMode", () => {
  test("names each rung of the ladder", () => {
    expect(currentAutoMode(false, false, false)).toBe("manual")
    expect(currentAutoMode(true, false, false)).toBe("skip-ask")
    expect(currentAutoMode(true, true, false)).toBe("continue")
    expect(currentAutoMode(true, true, true)).toBe("auto")
  })

  test("an off-ladder config rounds to a real rung instead of naming nothing", () => {
    // A hand-edited config, or one written before the ladder existed, can hold
    // combinations the ladder does not contain. The indicator still has to say
    // something true about what will happen next.
    expect(currentAutoMode(false, true, false)).toBe("continue")
    expect(currentAutoMode(false, false, true)).toBe("auto")
  })

  test("'auto' is only the top rung, never a lower one", () => {
    // The original bug: both-off also rendered as "Auto", so the indicator
    // claimed autonomy the agent did not have.
    expect(currentAutoMode(false, false, false)).not.toBe("auto")
    expect(currentAutoMode(true, false, false)).not.toBe("auto")
    expect(currentAutoMode(true, true, false)).not.toBe("auto")
  })

  test("the ladder is monotonic — nothing runs unattended while still asking", () => {
    // The state that made this confusing in the first place: keep going after a
    // turn, but stop to ask permission. Unattended that parks on the first
    // prompt with nobody there, so no rung may contain it.
    for (const mode of MODES) {
      if (mode.auto_continue) expect(mode.auto_mode).toBe(true)
      if (mode.auto_queue) expect(mode.auto_continue).toBe(true)
    }
  })
})
