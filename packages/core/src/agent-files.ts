export * as AgentFiles from "./agent-files.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, Effect, Layer } from "effect"
import { Environment } from "./environment/index.js"
import { SandboxFileProtocol } from "./sandbox/file-protocol.js"
import { Sandbox } from "./sandbox.js"

export interface WriteCheck {
  readonly path: string
  readonly operation: "write" | "remove"
  readonly bytes?: number
}

export interface Interface {
  readonly sandboxed: boolean
  readonly files: Environment.Files
  /** Nonmutating patch preflight; the kernel still checks every subsequent operation. */
  readonly checkWrites: (targets: readonly WriteCheck[]) => Effect.Effect<void, Environment.Failed>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/AgentFiles") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const environment = yield* Environment.Service
    const sandbox = yield* Sandbox.Service
    if (!sandbox.enabled)
      return Service.of({ sandboxed: false, files: environment.files, checkWrites: () => Effect.void })

    // Resolve per operation so reference changes take effect without a host I/O fallback.
    const binding = (target: string) =>
      sandbox.files.pipe(Effect.mapError((cause) => new Environment.Failed({ path: target, cause })))
    const files: Environment.Files = {
      read: (target, range) => binding(target).pipe(Effect.flatMap((files) => files.read(target, range))),
      stat: (target) => binding(target).pipe(Effect.flatMap((files) => files.stat(target))),
      list: (target) => binding(target).pipe(Effect.flatMap((files) => files.list(target))),
      write: (target, bytes) => binding(target).pipe(Effect.flatMap((files) => files.write(target, bytes))),
      mkdir: (target) => binding(target).pipe(Effect.flatMap((files) => files.mkdir(target))),
      remove: (target) => binding(target).pipe(Effect.flatMap((files) => files.remove(target))),
      move: (from, to) => binding(from).pipe(Effect.flatMap((files) => files.move(from, to))),
    }
    return Service.of({
      sandboxed: true,
      files,
      checkWrites: (targets) =>
        Effect.gen(function* () {
          const oversized = targets.find(
            (target) => target.bytes !== undefined && target.bytes > SandboxFileProtocol.MAX_DATA_BYTES,
          )
          if (oversized)
            return yield* new Environment.Failed({
              path: oversized.path,
              cause: new Error("File helper write exceeds its collection limit"),
            })
          yield* Effect.forEach(
            targets,
            (target) =>
              binding(target.path).pipe(Effect.flatMap((files) => files.check(target.path, target.operation))),
            { discard: true },
          )
        }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Environment.node, Sandbox.node] })

export const guidance =
  "Native file tools cannot leave the sandbox. To request access outside it, use the shell tool with sandbox_permissions=require_escalated and a justification."
