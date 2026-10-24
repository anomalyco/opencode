import { describe, expect, test } from "bun:test"
import { ServerConnection } from "@/runtime/server/registry"
import { pinnedIDs, withPin, withoutPins } from "./pins"

const server = ServerConnection.Key.make("sidecar")

describe("session pins", () => {
  test("keeps the order pins were added in and ignores a repeat", () => {
    const pins = withPin(withPin({}, server, "ses_a"), server, "ses_b")

    expect(pinnedIDs(pins, server)).toEqual(["ses_a", "ses_b"])
    expect(withPin(pins, server, "ses_a")).toBe(pins)
  })

  test("keeps the remaining order when unpinning and drops the server once empty", () => {
    const pins = withPin(withPin({}, server, "ses_a"), server, "ses_b")

    expect(pinnedIDs(withoutPins(pins, server, ["ses_a"]), server)).toEqual(["ses_b"])
    expect(withoutPins(pins, server, ["ses_a", "ses_b"])).toEqual({})
    expect(withoutPins(pins, server, ["ses_missing"])).toBe(pins)
  })
})
