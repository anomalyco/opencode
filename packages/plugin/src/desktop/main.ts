export * as MainPlugin from "./main.js"
import type { BrowserWindow, View } from "electron"
import type { OpenCodeClient } from "@opencode/client/effect"
import type { Rpc } from "@opencode/schema/rpc"
import type { Lifecycle } from "./context.js"
import { Schema } from "effect"

export interface Context {
  readonly window: BrowserWindow
  readonly lifecycle: Lifecycle
  /** Returns an authenticated Node-side client for a host-known server. */
  client(serverID: string): Promise<OpenCodeClient>
  readonly surfaces: {
    register(view: View): { readonly id: string; dispose(): void }
  }
  emit<D extends Rpc.Definition, Name extends keyof D["events"] & string>(
    definition: D,
    name: Name,
    data: Rpc.EventInputData<D["events"][Name]["schema"]>,
  ): Promise<void>
}

export type Handlers<D extends Rpc.Definition> = {
  [Name in keyof D["methods"]]: (
    input: Rpc.Output<D["methods"][Name]["input"]>,
    call: { signal: AbortSignal; error: Rpc.ErrorFactory<D["methods"][Name]> },
  ) => Rpc.HandlerOutput<D["methods"][Name]["output"]> | Promise<Rpc.HandlerOutput<D["methods"][Name]["output"]>>
}

export interface Definition<D extends Rpc.Definition = Rpc.Definition> {
  readonly id: string
  readonly rpc: D
  readonly setup: (context: Context) => Handlers<D>
}

/** Type-erased host entrypoint; authors register through define to retain method correlations. */
export interface Entry {
  readonly id: string
  readonly rpc: Rpc.Definition
  readonly setup: (
    context: Context,
  ) => Record<
    string,
    (
      input: unknown,
      call: { signal: AbortSignal; error: (type: string, message: string, data?: unknown) => never },
    ) => unknown
  >
}

export function define<const D extends Rpc.Definition>(definition: Definition<D>): Entry {
  return definition as Entry
}

export const Entry = Schema.declare<Entry>(
  (value): value is Entry =>
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "setup" in value &&
    typeof value.setup === "function" &&
    "rpc" in value &&
    typeof value.rpc === "object" &&
    value.rpc !== null &&
    "id" in value.rpc &&
    typeof value.rpc.id === "string" &&
    "methods" in value.rpc &&
    "events" in value.rpc,
)
