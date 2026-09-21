import { expect, test } from "bun:test"
import { HighlightsStore } from "./highlights"
import { Codec } from "@/runtime/persistence/codec"

test("highlight persistence defaults missing or invalid versions and round-trips valid versions", () => {
  const decode = ((input: unknown) => Codec.decodeOrThrow(Codec.withInitial(HighlightsStore, { version: undefined }), input))
  expect(decode({})).toEqual({ version: undefined })
  expect(decode({ version: null })).toEqual({ version: undefined })
  const value = decode({ version: "1.2.3", legacy: true })
  expect(value).toEqual({ version: "1.2.3" })
  expect(HighlightsStore.encode(value)).toEqual(value)
})

