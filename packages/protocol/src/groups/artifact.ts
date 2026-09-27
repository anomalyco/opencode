import { Artifact } from "@opencode-ai/schema/artifact"
import { Project } from "@opencode-ai/schema/project"
import { Session } from "@opencode-ai/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ArtifactNotFoundError, SessionNotFoundError } from "../errors"

export const ArtifactGroup = HttpApiGroup.make("server.artifact")
  .add(
    HttpApiEndpoint.get("artifact.list", "/api/artifact", {
      query: Schema.Struct({
        projectID: Project.ID.pipe(Schema.optional),
        type: Artifact.Type.pipe(Schema.optional),
        status: Artifact.Status.pipe(Schema.optional),
        agent: Schema.String.pipe(Schema.optional),
        task: Schema.String.pipe(Schema.optional),
        sessionID: Session.ID.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Schema.Array(Artifact.Info) }),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.list",
        summary: "List artifacts",
        description: "Retrieve artifacts, optionally filtered by project, type, status, agent, task, or session.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("artifact.get", "/api/artifact/:id", {
      params: { id: Artifact.ID },
      success: Schema.Struct({ data: Artifact.Info }),
      error: ArtifactNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.get",
        summary: "Get artifact",
        description: "Retrieve one artifact with its comments.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("artifact.create", "/api/artifact", {
      payload: Schema.Struct({
        projectID: Project.ID.pipe(Schema.optional),
        sessionID: Session.ID.pipe(Schema.optional),
        name: Schema.String,
        type: Artifact.Type,
        status: Artifact.Status.pipe(Schema.optional),
        agent: Schema.String.pipe(Schema.optional),
        task: Schema.String.pipe(Schema.optional),
        content: Schema.String,
        diff: Schema.String.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Artifact.Info }),
      error: SessionNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.create",
        summary: "Create artifact",
        description:
          "Create a first-class artifact. When sessionID links the artifact to a session, human comments are steered back to that session as actionable context.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.patch("artifact.update", "/api/artifact/:id", {
      params: { id: Artifact.ID },
      payload: Schema.Struct({
        name: Schema.String.pipe(Schema.optional),
        status: Artifact.Status.pipe(Schema.optional),
        agent: Schema.String.pipe(Schema.optional),
        task: Schema.String.pipe(Schema.optional),
        content: Schema.String.pipe(Schema.optional),
        diff: Schema.String.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Artifact.Info }),
      error: ArtifactNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.update",
        summary: "Update artifact",
        description: "Update artifact fields; every update increments the artifact version.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("artifact.comment", "/api/artifact/:id/comment", {
      params: { id: Artifact.ID },
      payload: Schema.Struct({
        author: Schema.String,
        body: Schema.String,
      }),
      success: Schema.Struct({
        data: Schema.Struct({ comment: Artifact.Comment, delivered: Schema.Boolean }),
      }),
      error: ArtifactNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.artifact.comment",
        summary: "Comment on artifact",
        description:
          "Attach a human comment directly to an artifact. delivered reports whether the comment was admitted to the linked session as actionable context for the responsible agent.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "artifact",
      description: "First-class artifacts with human comments that return to agents as actionable context.",
    }),
  )
