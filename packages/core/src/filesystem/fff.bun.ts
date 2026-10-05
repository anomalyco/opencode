import { bind } from "./fff.js"

export type { Directory, DirSearch, File, Init, Mixed, MixedSearch, Picker, Result, Search } from "./fff.js"

declare global {
  const FFF_LIBC: "gnu" | "musl"
}

const adapter = bind(undefined, "fff is unavailable on this platform")

export const available = adapter.available
export const create = adapter.create

export * as Fff from "./fff.bun.js"
