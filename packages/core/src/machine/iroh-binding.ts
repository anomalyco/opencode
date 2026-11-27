import type { Endpoint, EndpointAddr, EndpointId } from "@number0/iroh"
import { createRequire } from "node:module"

// The Iroh binding, an optional dependency with no build for some platforms (Intel Macs). The CLI build replaces this
// module per target with a `require` of that target's native package, or with `undefined` where there is none
// (`irohBindingPlugin` in packages/cli/script/build.ts). Elsewhere it is a `require` of a name held in a variable, as
// the file watcher's binding is, so other bundlers, such as the SDK's workerd build, leave the native module out.

export interface Binding {
  readonly Endpoint: typeof Endpoint
  readonly EndpointAddr: typeof EndpointAddr
  readonly EndpointId: typeof EndpointId
}

const name = "@number0/iroh"

// Lazy: on workerd import.meta.url is undefined, so createRequire must not run at module scope.
export default async (): Promise<Binding | undefined> => createRequire(import.meta.url)(name)
