import { describe, expect, test } from "bun:test"
import { Installation } from "@/installation"

describe("upgrade", () => {
  test("Installation.Event.Updated type matches expected value", () => {
    expect(Installation.Event.Updated.type).toBe("installation.updated")
  })

  test("Installation.Event.UpdateAvailable type matches expected value", () => {
    expect(Installation.Event.UpdateAvailable.type).toBe("installation.update-available")
  })
})
