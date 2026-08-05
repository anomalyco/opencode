// The auto-mode indicator is two independent booleans presented as four named
// states. Getting that mapping wrong means the pill lies about what the agent
// will do — which is worse than having no indicator.
import { describe, expect, test } from "bun:test"
import { currentAutoMode } from "../src/component/dialog-auto-mode"

describe("currentAutoMode", () => {
  test("names every combination of the two switches", () => {
    expect(currentAutoMode(false, false)).toBe("manual")
    expect(currentAutoMode(true, false)).toBe("skip-ask")
    expect(currentAutoMode(false, true)).toBe("continue")
    expect(currentAutoMode(true, true)).toBe("auto")
  })

  test("'auto' means BOTH switches, never just one", () => {
    // The original bug: both-off also rendered as "Auto", so the indicator
    // claimed autonomy the agent did not have.
    expect(currentAutoMode(false, false)).not.toBe("auto")
    expect(currentAutoMode(true, false)).not.toBe("auto")
    expect(currentAutoMode(false, true)).not.toBe("auto")
  })
})
