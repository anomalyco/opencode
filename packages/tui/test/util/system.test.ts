import { describe, expect, test } from "bun:test"
import { kittyKeyboardOptions } from "../../src/util/system"

describe("kittyKeyboardOptions", () => {
  test("leaves OpenTUI defaults when neither option is set", () => {
    expect(kittyKeyboardOptions({ disabled: false })).toEqual({})
  })

  test("enables key event types when requested", () => {
    expect(kittyKeyboardOptions({ disabled: false, events: true })).toEqual({ events: true })
  })

  test("disables the protocol with explicit zero flags", () => {
    expect(kittyKeyboardOptions({ disabled: true })).toEqual({ disambiguate: false, alternateKeys: false })
  })

  test("disabling wins over event types so the modifyOtherKeys fallback stays active", () => {
    expect(kittyKeyboardOptions({ disabled: true, events: true })).toEqual({
      disambiguate: false,
      alternateKeys: false,
    })
  })
})
