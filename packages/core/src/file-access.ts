export * as FileAccess from "./file-access.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import type { FSUtil } from "@opencode-ai/util/fs-util"
import { Context, Effect, Layer } from "effect"
import path from "path"
import { LocationMutation } from "./location-mutation.js"
import { Permission } from "./permission.js"
import type { SessionErrors } from "./session/error.js"
import type { Tool } from "./tool.js"

export type Target = LocationMutation.Target
export type Invocation = Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">

export interface ReadOptions {
  /** A target already authorized by this invocation, used for filename recovery. */
  readonly siblingOf: Target
}

export interface Interface {
  /** Resolve a read target and obtain external-directory approval before read approval. */
  readonly authorizeRead: (
    file: string,
    context: Invocation,
    options?: ReadOptions,
  ) => Effect.Effect<Target, FSUtil.Error | Error | SessionErrors.NotFoundError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileAccess") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const paths = yield* LocationMutation.Service
    const permission = yield* Permission.Service

    const authorizeRead = Effect.fn("FileAccess.authorizeRead")(function* (
      file: string,
      context: Invocation,
      options?: ReadOptions,
    ) {
      const target = yield* paths.resolve({ path: file, kind: options ? "file" : undefined })
      const invocation = {
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool" as const, messageID: context.messageID, id: context.id },
      }
      const sibling = options && path.dirname(target.absolute) === path.dirname(options.siblingOf.absolute)

      // Filename recovery shares the directory approval, but checks the recovered file's own read rules.
      if (target.externalDirectory && !sibling)
        yield* permission.assert({
          ...LocationMutation.externalDirectoryPermission(target.externalDirectory),
          ...invocation,
        })
      yield* permission.assert({
        action: "read",
        resources: [target.resource],
        save: ["*"],
        ...invocation,
      })
      return target
    })

    return Service.of({ authorizeRead })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [LocationMutation.node, Permission.node] })
