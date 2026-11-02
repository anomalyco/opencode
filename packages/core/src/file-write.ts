export * as FileWrite from "./file-write.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import type { FileDiff } from "@opencode/schema/file-diff"
import { Bom } from "@opencode/util/bom"
import { Context, Effect, Layer } from "effect"
import { Environment } from "./environment/index.js"
import { FileAccess } from "./file-access.js"
import { FileMutation } from "./file-mutation.js"
import { Formatter } from "./formatter.js"
import { Permission } from "./permission.js"
import type { SessionErrors } from "./session/error.js"
import { fileDiff } from "./tool/plugin/file-diff.js"

export interface WriteInput {
  readonly path: string
  readonly content: string
}

export interface Written extends FileMutation.TextWriteResult {
  /** The file text after a formatter ran on it. */
  readonly formatted?: string
}

export interface Interface {
  /** Resolve a file to write and obtain external-directory approval. */
  readonly target: (
    file: string,
    context: FileAccess.Invocation,
  ) => Effect.Effect<FileAccess.Target, Environment.Failed | Permission.Error | SessionErrors.NotFoundError>
  /** Request edit approval for a resolved target, showing the change when it is known. */
  readonly authorize: (
    target: FileAccess.Target,
    context: FileAccess.Invocation,
    preview?: FileDiff.Info,
  ) => Effect.Effect<void, Permission.Error | SessionErrors.NotFoundError>
  /** Write approved text, keeping an existing UTF-8 BOM, then format the file. */
  readonly commit: (
    target: FileAccess.Target,
    content: string,
  ) => Effect.Effect<Written, Environment.NotFound | Environment.WrongKind | Environment.Failed>
  /** Resolve, approve, write and format a whole file. */
  readonly write: (
    input: WriteInput,
    context: FileAccess.Invocation,
  ) => Effect.Effect<
    Written,
    Environment.NotFound | Environment.WrongKind | Environment.Failed | Permission.Error | SessionErrors.NotFoundError
  >
}

export class Service extends Context.Service<Service, Interface>()("@opencode/FileWrite") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const access = yield* FileAccess.Service
    const environment = yield* Environment.Service
    const fileMutation = yield* FileMutation.Service
    const formatter = yield* Formatter.Service
    const permission = yield* Permission.Service

    const target = Effect.fn("FileWrite.target")(function* (file: string, context: FileAccess.Invocation) {
      const target = yield* access.resolve({ path: file, kind: "file" })
      yield* access.authorizeExternal([target], context)
      return target
    })

    const authorize = Effect.fn("FileWrite.authorize")(function* (
      target: FileAccess.Target,
      context: FileAccess.Invocation,
      preview?: FileDiff.Info,
    ) {
      yield* permission.assert({
        action: "edit",
        resources: [target.resource],
        save: ["*"],
        metadata: preview ? { files: [preview] } : undefined,
        sessionID: context.sessionID,
        agent: context.agent,
        source: { type: "tool", messageID: context.messageID, id: context.id },
      })
    })

    const commit = Effect.fn("FileWrite.commit")(function* (target: FileAccess.Target, content: string) {
      const written = yield* fileMutation.writeTextPreservingBom({ target, content })
      if (!(yield* formatter.file(target.absolute))) return written
      return {
        ...written,
        formatted: yield* FileMutation.syncTextBom(environment.files, target.absolute, written.bom),
      } satisfies Written
    })

    const write = Effect.fn("FileWrite.write")(function* (input: WriteInput, context: FileAccess.Invocation) {
      const resolved = yield* target(input.path, context)
      const current = yield* FileMutation.readOptionalText(environment.files, resolved.absolute)
      yield* authorize(
        resolved,
        context,
        fileDiff(resolved.resource, current?.text ?? "", Bom.split(input.content).text, current ? "modified" : "added"),
      )
      return yield* commit(resolved, input.content)
    })

    return Service.of({ target, authorize, commit, write })
  }),
)

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Environment.node, FileAccess.node, FileMutation.node, Formatter.node, Permission.node],
})
