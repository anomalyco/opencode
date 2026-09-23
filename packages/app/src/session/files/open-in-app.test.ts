import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { OPEN_APPS, OpenAppPreferences } from "./open-in-app"
import { Persistence } from "@/runtime/persistence/schema"

const decode = Schema.decodeUnknownSync(Persistence.withInitial(OpenAppPreferences, { app: "finder" }))

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
