import { bind } from "./fff.js"

export type { Directory, DirSearch, File, Init, Mixed, MixedSearch, Picker, Result, Search } from "./fff.js"

const { FileFinder } = await import("@ff-labs/fff-node").catch(() => ({ FileFinder: undefined }))

const adapter = bind(FileFinder, "fff unavailable on node runtime")

export const available = adapter.available
export const create = adapter.create

export * as Fff from "./fff.node.js"
