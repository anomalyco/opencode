import type { Brand } from "effect"
import { Codec } from "@/runtime/persistence/codec"

// The server key's brand is shared with the Effect schema in ./persistence.ts (type only, so this
// module loads nothing of Effect), letting stores port to plain codecs one at a time.
export type ServerKey = string & Brand.Brand<"ServerConnection.Key">

export const ServerKey: Codec.Of<ServerKey, string> & { make(value: string): ServerKey } = Object.assign(
  Codec.make<ServerKey, string>((v) => (typeof v === "string" ? (v as ServerKey) : Codec.INVALID), (v) => v),
  { make: (value: string) => value as ServerKey },
)
