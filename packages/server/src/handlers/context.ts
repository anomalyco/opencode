import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { RelativePath } from "@opencode-ai/core/schema"
import { ContextInspection } from "@opencode-ai/core/system-context/inspect"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import path from "path"
import { Api } from "../api"
import { InvalidRequestError } from "@opencode-ai/protocol/errors"
import { response } from "../location"

export const ContextHandler = HttpApiBuilder.group(Api, "server.context", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle("context.inspect", (ctx) =>
        response(
          ContextInspection.inspect(ctx.query.agent).pipe(
            Effect.map((sources) =>
              sources.map((source) =>
                source.path === undefined
                  ? { ...source, path: undefined }
                  : { ...source, path: RelativePath.make(source.path) },
              ),
            ),
          ),
        ),
      )
      .handle("context.writeInstruction", (ctx) =>
        response(
          Effect.gen(function* () {
            const location = yield* Location.Service
            const fileMutation = yield* FileMutation.Service
            const directory = String(location.directory)
            const target = path.resolve(directory, ctx.payload.path)
            if (!FSUtil.contains(directory, target) || path.basename(target) !== "AGENTS.md") {
              return yield* new InvalidRequestError({
                message: `Refusing to write outside the project: ${ctx.payload.path}`,
              })
            }
            yield* fileMutation.write({
              target: { canonical: target, resource: ctx.payload.path },
              content: ctx.payload.content,
            })
            return {
              key: `instructions/${ctx.payload.path}`,
              kind: "instructions" as const,
              title: ctx.payload.path,
              path: ctx.payload.path,
              editable: true,
              content: ctx.payload.content,
            }
          }).pipe(Effect.catch(() => Effect.fail(new InvalidRequestError({ message: "Failed to write instructions file." })))),
        ),
      )
  }),
)
