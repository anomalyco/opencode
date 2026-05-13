import type { Univer } from "@univerjs/core"
import type { FUniver } from "@univerjs/core/facade"

export type Host = { univer: Univer; univerAPI: FUniver }

let host: Host | undefined

export function bindVeritlyUniverHost(next: Host) {
  host = next
}

export function clearVeritlyUniverHost() {
  host = undefined
}

export function veritlyUniverHost(): Host | undefined {
  return host
}
