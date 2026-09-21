import { describe, expect, test } from "bun:test"
import { OPEN_APPS, OpenAppPreferences } from "./open-in-app"
import { Codec } from "@/runtime/persistence/codec"

const decode = ((input: unknown) => Codec.decodeOrThrow(Codec.withInitial(OpenAppPreferences, { app: "finder" }), input))

describe("open app preferences", () => {
  test.each([...OPEN_APPS])("preserves the %s preference", (app) => {
    expect(decode({ app })).toEqual({ app })
  })

  test.each([undefined, null, 42, "unknown", {}])("defaults invalid selection %p", (app) => {
    expect(decode({ app })).toEqual({ app: "finder" })
  })

  test("defaults an absent selection", () => {
    expect(decode({})).toEqual({ app: "finder" })
  })
})

