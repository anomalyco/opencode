export * as ApplicationToolRegistry from "./application-registry"

import { Context, Deferred, Effect, Layer, Schema, Scope, Semaphore } from "effect"
import { ApplicationTool } from "./application"
import type { ToolRegistry } from "./registry"

export class NameConflictError extends Schema.TaggedErrorClass<NameConflictError>()(
  "ApplicationTool.NameConflictError",
  {
    name: Schema.String,
  },
) {}

export interface Interface {
  readonly attach: (
    tools: Readonly<Record<string, ApplicationTool.Any>>,
  ) => Effect.Effect<void, NameConflictError, Scope.Scope>
  readonly snapshot: () => Effect.Effect<ReadonlyMap<string, ToolRegistry.Entry>, never, Scope.Scope>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ApplicationToolRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    type Attachment = {
      readonly entries: ReadonlyMap<string, ToolRegistry.Entry>
      leases: number
      closing?: Deferred.Deferred<void>
    }
    const entries = new Map<string, Attachment>()
    const semaphore = Semaphore.makeUnsafe(1)

    const release = (attachment: Attachment) =>
      semaphore
        .withPermit(
          Effect.gen(function* () {
            for (const name of attachment.entries.keys()) entries.delete(name)
            if (attachment.leases === 0) return undefined
            const closing = yield* Deferred.make<void>()
            attachment.closing = closing
            return closing
          }),
        )
        .pipe(Effect.flatMap((closing) => (closing === undefined ? Effect.void : Deferred.await(closing))))

    const attach = Effect.fn("ApplicationToolRegistry.attach")(function* (
      tools: Readonly<Record<string, ApplicationTool.Any>>,
    ) {
      const names = Object.keys(tools)
      yield* Effect.acquireRelease(
        semaphore.withPermit(
          Effect.gen(function* () {
            const conflict = names.find((name) => entries.has(name))
            if (conflict !== undefined) return yield* new NameConflictError({ name: conflict })
            const attachment: Attachment = {
              entries: new Map(names.map((name) => [name, ApplicationTool.entry(tools[name])])),
              leases: 0,
            }
            for (const name of names) entries.set(name, attachment)
            return attachment
          }),
        ),
        release,
      )
    })

    const snapshot = Effect.fn("ApplicationToolRegistry.snapshot")(function* () {
      const lease = yield* Effect.acquireRelease(
        semaphore.withPermit(
          Effect.sync(() => {
            const attachments = Array.from(new Set(entries.values()))
            for (const attachment of attachments) attachment.leases++
            return {
              attachments,
              entries: new Map(
                Array.from(entries, ([name, attachment]) => [name, attachment.entries.get(name)!]),
              ) as ReadonlyMap<string, ToolRegistry.Entry>,
            }
          }),
        ),
        ({ attachments }) =>
          semaphore
            .withPermit(
              Effect.sync(() => {
                const closing: Deferred.Deferred<void>[] = []
                for (const attachment of attachments) {
                  attachment.leases--
                  if (attachment.leases === 0 && attachment.closing !== undefined) closing.push(attachment.closing)
                }
                return closing
              }),
            )
            .pipe(
              Effect.flatMap((closing) =>
                Effect.forEach(closing, (deferred) => Deferred.succeed(deferred, undefined), { discard: true }),
              ),
            ),
      )
      return lease.entries
    })

    return Service.of({
      attach,
      snapshot,
    })
  }),
)
