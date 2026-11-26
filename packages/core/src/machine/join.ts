export * as Join from "./join.js"

import { Option, Schema } from "effect"

/** A way to reach the home, as the worker's transport understands it. `iroh` dials the join string's `home` key. */
export const Reach = Schema.Union([
  Schema.Struct({ type: Schema.Literal("url"), url: Schema.String }),
  Schema.Struct({ type: Schema.Literal("iroh") }),
])
export type Reach = typeof Reach.Type

const PREFIX = "ocjoin_"
/** Longer than any join string this home prints, so a hostile one is refused before it is decoded. */
const MAX_LENGTH = 4_096
const Key = Schema.Uint8ArrayFromBase64Url.check(Schema.isBetweenLength(32, 32))
const Expires = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))

// The Rust worker parses this too: plain JSON with these names, and `reach` entries this worker cannot use are dropped.
const Wire = Schema.Struct({
  v: Schema.Literal(1),
  home: Key,
  secret: Key,
  expires: Expires,
  reach: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
})

export interface Value {
  readonly v: 1
  readonly home: Uint8Array
  readonly secret: Uint8Array
  readonly expires: number
  readonly reach: ReadonlyArray<Reach>
}

const decodeReach = Schema.decodeUnknownOption(Reach)
const decodeWire = Schema.decodeUnknownOption(Schema.fromJsonString(Wire))
const encodeWire = Schema.encodeSync(Schema.fromJsonString(Wire))

export const encode = (value: Value) => `${PREFIX}${Buffer.from(encodeWire(value)).toString("base64url")}`

export const decode = (text: string) => {
  if (text.length > MAX_LENGTH || !text.startsWith(PREFIX)) return Option.none()
  const encoded = text.slice(PREFIX.length)
  const bytes = Buffer.from(encoded, "base64url")
  // Buffer tolerates trailing junk; the strict decoder the Rust worker will use does not, so only canonical text passes.
  if (bytes.toString("base64url") !== encoded) return Option.none()
  return Option.map(decodeWire(bytes.toString()), (wire) => ({
    v: wire.v,
    home: wire.home,
    secret: wire.secret,
    expires: wire.expires,
    reach: wire.reach.flatMap((entry) => Option.toArray(decodeReach(entry))),
  }))
}
