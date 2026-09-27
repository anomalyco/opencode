import { Artifact } from "@opencode-ai/core/artifact"
import { Location } from "@opencode-ai/core/location"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { ArtifactNotFoundError, SessionNotFoundError } from "@opencode-ai/protocol/errors"

function missingArtifact(id: Artifact.ID) {
  return new ArtifactNotFoundError({ artifactID: id, message: `Artifact not found: ${id}` })
}

export const ArtifactHandler = HttpApiBuilder.group(Api, "server.artifact", (handlers) =>
  Effect.gen(function* () {
    const artifact = yield* Artifact.Service

    return handlers
      .handle(
        "artifact.list",
        Effect.fn(function* (ctx) {
          const location = yield* Location.Service
          return {
            data: yield* artifact.list({
              projectID: ctx.query.projectID ?? location.project.id,
              ...(ctx.query.type !== undefined ? { type: ctx.query.type } : {}),
              ...(ctx.query.status !== undefined ? { status: ctx.query.status } : {}),
              ...(ctx.query.agent !== undefined ? { agent: ctx.query.agent } : {}),
              ...(ctx.query.task !== undefined ? { task: ctx.query.task } : {}),
              ...(ctx.query.sessionID !== undefined ? { sessionID: ctx.query.sessionID } : {}),
            }),
          }
        }),
      )
      .handle(
        "artifact.get",
        Effect.fn(function* (ctx) {
          return {
            data: yield* artifact
              .get(ctx.params.id)
              .pipe(Effect.catchTag("Artifact.NotFoundError", () => missingArtifact(ctx.params.id))),
          }
        }),
      )
      .handle(
        "artifact.create",
        Effect.fn(function* (ctx) {
          const location = yield* Location.Service
          return {
            data: yield* artifact
              .create({
                projectID: ctx.payload.projectID ?? location.project.id,
                ...(ctx.payload.sessionID !== undefined ? { sessionID: ctx.payload.sessionID } : {}),
                name: ctx.payload.name,
                type: ctx.payload.type,
                ...(ctx.payload.status !== undefined ? { status: ctx.payload.status } : {}),
                ...(ctx.payload.agent !== undefined ? { agent: ctx.payload.agent } : {}),
                ...(ctx.payload.task !== undefined ? { task: ctx.payload.task } : {}),
                content: ctx.payload.content,
                ...(ctx.payload.diff !== undefined ? { diff: ctx.payload.diff } : {}),
              })
              .pipe(
                Effect.catchTag(
                  "Session.NotFoundError",
                  (error) =>
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                ),
              ),
          }
        }),
      )
      .handle(
        "artifact.update",
        Effect.fn(function* (ctx) {
          return {
            data: yield* artifact
              .update({
                id: ctx.params.id,
                ...(ctx.payload.name !== undefined ? { name: ctx.payload.name } : {}),
                ...(ctx.payload.status !== undefined ? { status: ctx.payload.status } : {}),
                ...(ctx.payload.agent !== undefined ? { agent: ctx.payload.agent } : {}),
                ...(ctx.payload.task !== undefined ? { task: ctx.payload.task } : {}),
                ...(ctx.payload.content !== undefined ? { content: ctx.payload.content } : {}),
                ...(ctx.payload.diff !== undefined ? { diff: ctx.payload.diff } : {}),
              })
              .pipe(Effect.catchTag("Artifact.NotFoundError", () => missingArtifact(ctx.params.id))),
          }
        }),
      )
      .handle(
        "artifact.comment",
        Effect.fn(function* (ctx) {
          return {
            data: yield* artifact
              .comment({ id: ctx.params.id, author: ctx.payload.author, body: ctx.payload.body })
              .pipe(Effect.catchTag("Artifact.NotFoundError", () => missingArtifact(ctx.params.id))),
          }
        }),
      )
  }),
)
