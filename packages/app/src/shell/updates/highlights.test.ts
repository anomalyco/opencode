import { expect, test } from "bun:test"
import { Schema } from "effect"
import { HighlightsStore } from "./highlights"
import { Persistence } from "@/runtime/persistence/schema"

test("highlight persistence defaults missing or invalid versions and round-trips valid versions", () => {
  const decode = Schema.decodeUnknownSync(Persistence.withInitial(HighlightsStore, { version: undefined }))
  expect(decode({})).toEqual({ version: undefined })
  expect(decode({ version: null })).toEqual({ version: undefined })
  const value = decode({ version: "1.2.3", legacy: true })
  expect(value).toEqual({ version: "1.2.3" })
  expect(Schema.encodeSync(HighlightsStore)(value)).toEqual(value)
})
