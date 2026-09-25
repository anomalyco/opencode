import { expect, test } from "bun:test"
import { Codec } from "./codec"

// Type-level checks: these compile only if inference matches what `typeof schema.Type` gave callers.
test("struct types infer optional and required fields", () => {
  const s = Codec.struct({ id: Codec.string, tab: Codec.optional(Codec.string), n: Codec.lenientOptional(Codec.number) })
  const value: typeof s.Type = { id: "x" }
  const tab: string | undefined = value.tab
  const n: number | undefined = value.n
  const t = Codec.transform(s, { decode: (old) => old.tab ?? old.id, encode: (v) => ({ id: v }) })
  const out: string | Codec.Invalid = t.decode({ id: "a" })
  const onlyOptional = Codec.struct({ tab: Codec.optional(Codec.string) })
  const empty: typeof onlyOptional.Type = {}
  const maybe: string | undefined = empty.tab
  const viaTransform = Codec.transform(onlyOptional, { decode: (old) => old.tab, encode: (tab) => ({ tab }) })
  expect([tab, n, out, maybe, viaTransform.decode({})]).toEqual([undefined, undefined, "a", undefined, undefined])
})
