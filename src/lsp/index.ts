/**
 * LSP stub — no-op replacement.
 * The browser agent doesn't need language servers.
 * This stub exports the same types/interfaces so existing code compiles
 * but nothing is spawned or loaded.
 */

import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Effect, Layer, ServiceMap } from "effect"
import { makeRuntime } from "@/effect/run-service"

export namespace LSP {
  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
  }

  export const Range = z.object({
    start: z.object({ line: z.number(), character: z.number() }),
    end: z.object({ line: z.number(), character: z.number() }),
  })
  export type Range = z.infer<typeof Range>

  export const Symbol = z.object({
    name: z.string(),
    kind: z.number(),
    location: z.object({ uri: z.string(), range: Range }),
  })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z.object({
    name: z.string(),
    kind: z.number(),
    range: Range,
    selectionRange: Range,
    children: z.lazy(() => z.array(DocumentSymbol)).optional(),
  })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  export const Status = z.object({
    id: z.string(),
    name: z.string(),
    running: z.boolean(),
    extensions: z.array(z.string()),
  })
  export type Status = z.infer<typeof Status>

  type LocInput = { file: string; line: number; character: number }

  export interface Interface {
    readonly init: () => Effect.Effect<void>
    readonly status: () => Effect.Effect<Status[]>
    readonly hasClients: (file: string) => Effect.Effect<boolean>
    readonly touchFile: (file: string, wait?: boolean) => Effect.Effect<void>
    readonly diagnostics: () => Effect.Effect<any[]>
    readonly hover: (input: LocInput) => Effect.Effect<string | undefined>
    readonly definition: (input: LocInput) => Effect.Effect<any[]>
    readonly references: (input: LocInput) => Effect.Effect<any[]>
    readonly implementation: (input: LocInput) => Effect.Effect<any[]>
    readonly documentSymbol: (uri: string) => Effect.Effect<DocumentSymbol[]>
    readonly workspaceSymbol: (query: string) => Effect.Effect<Symbol[]>
    readonly prepareCallHierarchy: (input: LocInput) => Effect.Effect<any[]>
    readonly incomingCalls: (input: LocInput) => Effect.Effect<any[]>
    readonly outgoingCalls: (input: LocInput) => Effect.Effect<any[]>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@athena/LSP") {}

  // No-op layer — does nothing
  export const layer = Layer.succeed(
    Service,
    Service.of({
      init: () => Effect.void,
      status: () => Effect.succeed([]),
      hasClients: () => Effect.succeed(false),
      touchFile: () => Effect.void,
      diagnostics: () => Effect.succeed([]),
      hover: () => Effect.succeed(undefined),
      definition: () => Effect.succeed([]),
      references: () => Effect.succeed([]),
      implementation: () => Effect.succeed([]),
      documentSymbol: () => Effect.succeed([]),
      workspaceSymbol: () => Effect.succeed([]),
      prepareCallHierarchy: () => Effect.succeed([]),
      incomingCalls: () => Effect.succeed([]),
      outgoingCalls: () => Effect.succeed([]),
    }),
  )

  export const defaultLayer = layer

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export const init = async () => {}
  export const status = async () => [] as Status[]
  export const hasClients = async (_file: string) => false
  export const touchFile = async (_input: string, _wait?: boolean) => {}
  export const diagnostics = async () => [] as any[]
  export const hover = async (_input: LocInput) => undefined
  export const definition = async (_input: LocInput) => [] as any[]
  export const references = async (_input: LocInput) => [] as any[]
  export const implementation = async (_input: LocInput) => [] as any[]
  export const documentSymbol = async (_uri: string) => [] as DocumentSymbol[]
  export const workspaceSymbol = async (_query: string) => [] as Symbol[]
  export const prepareCallHierarchy = async (_input: LocInput) => [] as any[]
  export const incomingCalls = async (_input: LocInput) => [] as any[]
  export const outgoingCalls = async (_input: LocInput) => [] as any[]

  export namespace Diagnostic {
    export function pretty(_diagnostic: any) {
      return ""
    }
  }
}
