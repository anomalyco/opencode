import { describe, expect, test } from "bun:test"
import { hints } from "@/command/index"

describe("command", () => {
  test("hints extracts numbered placeholders", () => {
    expect(hints("do $1 and $2")).toEqual(["$1", "$2"])
  })

  test("hints extracts $ARGUMENTS placeholder", () => {
    expect(hints("do $ARGUMENTS")).toEqual(["$ARGUMENTS"])
  })

  test("hints extracts mixed placeholders", () => {
    expect(hints("$1 $2 $ARGUMENTS")).toEqual(["$1", "$2", "$ARGUMENTS"])
  })

  test("hints deduplicates repeated placeholders", () => {
    expect(hints("$1 and $1 again")).toEqual(["$1"])
  })

  test("hints sorts numbered placeholders", () => {
    expect(hints("$3 $1 $2")).toEqual(["$1", "$2", "$3"])
  })

  test("hints returns empty array for no placeholders", () => {
    expect(hints("no placeholders here")).toEqual([])
  })

  test("hints handles empty string", () => {
    expect(hints("")).toEqual([])
  })
})
