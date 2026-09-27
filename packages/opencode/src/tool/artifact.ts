import { Artifact } from "@opencode-ai/core/artifact"
import { Effect, Schema } from "effect"
import { Session } from "@/session/session"
import * as Tool from "./tool"
import DESCRIPTION from "./artifact.txt"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list", "get", "create", "update"]).annotate({
    description: "The artifact operation to perform.",
  }),
  id: Schema.optional(Artifact.ID).annotate({ description: "Artifact id (required for get and update)." }),
  name: Schema.optional(Schema.String).annotate({
    description: "Artifact name (required for create; optional rename on update).",
  }),
  type: Schema.optional(Artifact.Type).annotate({
    description: "Artifact type (required for create; acts as a list filter with list).",
  }),
  status: Schema.optional(Artifact.Status).annotate({
    description: "Review status: create defaults to draft; update sets it; list filters by it.",
  }),
  agent: Schema.optional(Schema.String).annotate({
    description: "Responsible agent reference (create/update; acts as a list filter with list).",
  }),
  task: Schema.optional(Schema.String).annotate({
    description: "Related task reference (create/update; acts as a list filter with list).",
  }),
  content: Schema.optional(Schema.String).annotate({ description: "Artifact body (required for create)." }),
  diff: Schema.optional(Schema.String).annotate({
    description: "Unified diff content for diff-bearing artifacts (create/update).",
  }),
})

const requireField = <T>(action: string, name: string, value: T | undefined): T => {
  if (value === undefined) throw new Error(`The artifact action "${action}" requires "${name}".`)
  return value
}

export const ArtifactTool = Tool.define(
  "artifact",
  Effect.gen(function* () {
    const artifacts = yield* Artifact.Service
    const sessions = yield* Session.Service

    const notFound = (error: Artifact.NotFoundError) =>
      Effect.sync(() => {
        throw new Error(`No artifact exists with id ${error.artifactID}.`)
      })

    const run = (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context): Effect.Effect<Tool.ExecuteResult> =>
      Effect.gen(function* () {
        switch (params.action) {
          case "list": {
            const project = yield* sessions.get(ctx.sessionID)
            const rows = yield* artifacts.list({
              projectID: project.projectID,
              ...(params.type !== undefined ? { type: params.type } : {}),
              ...(params.status !== undefined ? { status: params.status } : {}),
              ...(params.agent !== undefined ? { agent: params.agent } : {}),
              ...(params.task !== undefined ? { task: params.task } : {}),
            })
            return {
              title: "artifact list",
              output:
                rows.length === 0
                  ? "No artifacts found."
                  : [
                      `${rows.length} artifact(s):`,
                      ...rows.map((row) =>
                        [
                          `${row.id} [${row.type}] "${row.name}" v${row.version} ${row.status}`,
                          ...(row.agent !== undefined ? [`agent=${row.agent}`] : []),
                          ...(row.task !== undefined ? [`task=${row.task}`] : []),
                          `comments=${row.comments.length}`,
                        ].join(" "),
                      ),
                    ].join("\n"),
              metadata: {},
            }
          }
          case "get": {
            const id = requireField("get", "id", params.id)
            const found = yield* artifacts.get(id).pipe(Effect.catchTag("Artifact.NotFoundError", notFound))
            return { title: "artifact get", output: JSON.stringify(found, null, 2), metadata: {} }
          }
          case "create": {
            const project = yield* sessions.get(ctx.sessionID)
            const created = yield* artifacts
              .create({
                projectID: project.projectID,
                sessionID: ctx.sessionID,
                name: requireField("create", "name", params.name),
                type: requireField("create", "type", params.type),
                content: requireField("create", "content", params.content),
                ...(params.status !== undefined ? { status: params.status } : {}),
                ...(params.agent !== undefined ? { agent: params.agent } : {}),
                ...(params.task !== undefined ? { task: params.task } : {}),
                ...(params.diff !== undefined ? { diff: params.diff } : {}),
              })
              .pipe(Effect.catchTag("Session.NotFoundError", (error) => Effect.die(error)))
            return {
              title: "artifact created",
              output:
                `Created artifact ${created.id} [${created.type}] "${created.name}" version ${created.version} ` +
                `(status ${created.status}), linked to session ${ctx.sessionID} — human comments on it return to this session as actionable context.`,
              metadata: {},
            }
          }
          case "update": {
            const id = requireField("update", "id", params.id)
            const updated = yield* artifacts
              .update({
                id,
                ...(params.name !== undefined ? { name: params.name } : {}),
                ...(params.status !== undefined ? { status: params.status } : {}),
                ...(params.agent !== undefined ? { agent: params.agent } : {}),
                ...(params.task !== undefined ? { task: params.task } : {}),
                ...(params.content !== undefined ? { content: params.content } : {}),
                ...(params.diff !== undefined ? { diff: params.diff } : {}),
              })
              .pipe(Effect.catchTag("Artifact.NotFoundError", notFound))
            return {
              title: "artifact updated",
              output: `Updated artifact ${updated.id}: now version ${updated.version} (status ${updated.status}).`,
              metadata: {},
            }
          }
          default:
            // `satisfies never` makes a new Parameters literal without a case
            // above a compile-time error instead of a silent fallthrough.
            return yield* Effect.die(new Error(`Unsupported artifact action: ${String(params.action satisfies never)}`))
        }
      }).pipe(Effect.orDie)

    return { description: DESCRIPTION, parameters: Parameters, execute: run }
  }),
)
