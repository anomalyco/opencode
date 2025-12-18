import { Identifier as SharedIdentifier } from "@opencode-ai/util/identifier"

export namespace Identifier {
  export type Prefix = SharedIdentifier.Prefix

  export const schema = (prefix: Prefix) => SharedIdentifier.schema(prefix)

  export function ascending(prefix: Prefix, given?: string) {
    return SharedIdentifier.ascending(prefix, given)
  }

  export function descending(prefix: Prefix, given?: string) {
    return SharedIdentifier.descending(prefix, given)
  }

  export function create(prefix: Prefix, descending: boolean, timestamp?: number) {
    return SharedIdentifier.createPrefixed(prefix, descending, timestamp)
  }
}
