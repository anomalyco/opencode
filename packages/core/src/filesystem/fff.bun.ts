import { FileFinder } from "@ff-labs/fff-bun"
import { bind } from "./fff.js"

export type { Directory, DirSearch, File, Init, Mixed, MixedSearch, Picker, Result, Search } from "./fff.js"

declare global {
  const FFF_LIBC: "gnu" | "musl"
}

const adapter = bind(FileFinder)

export const available = adapter.available
export const create = adapter.create

export * as Fff from "./fff.bun.js"
