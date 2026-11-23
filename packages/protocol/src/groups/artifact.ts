import { Artifact } from "@opencode/schema/artifact"
import { Location } from "@opencode/schema/location"
import { Session } from "@opencode/schema/session"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api"
import {
  ArtifactNotFoundError,
  FileNotFoundError,
  ForbiddenError,
  InvalidRequestError,
  LocationNotFoundError,
  ProviderNotFoundError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

const EXPERIMENTAL =
  "Experimental: needs experimental.artifacts in the Location's config and may change without notice."

const params = { artifactID: Artifact.ID }

const ListQuery = Schema.Struct({
  ...LocationQuery.fields,
  sessionID: Schema.optional(Session.ID),
  provider: Schema.optional(Artifact.ProviderID),
})

const annotations = (identifier: string, summary: string, description: string) =>
  OpenApi.annotations({
    identifier: `experimental.artifacts.${identifier}`,
    summary,
    description: `${description} ${EXPERIMENTAL}`,
    transform: (operation) => ({ ...operation, tags: ["experimental"] }),
  })

const commonErrors = [ForbiddenError, LocationNotFoundError, ServiceUnavailableError] as const
const itemErrors = [ArtifactNotFoundError, ...commonErrors] as const

/** Lives in the `server.experimental` group (see `groups/experimental.ts`). */
export const ArtifactEndpoints = [
  HttpApiEndpoint.get("artifacts.providers", "/api/experimental/artifacts/providers", {
    query: LocationQuery,
    success: Location.response(Schema.Array(Artifact.Provider)),
    error: commonErrors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(annotations("providers", "List artifact providers", "Return active artifact providers and default.")),
  HttpApiEndpoint.get("artifacts.list", "/api/experimental/artifacts", {
    query: ListQuery,
    success: Location.response(Schema.Array(Artifact.Info)),
    error: [SessionNotFoundError, ...commonErrors],
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(annotations("list", "List artifacts", "List published artifacts, newest update first.")),
  HttpApiEndpoint.post("artifacts.create", "/api/experimental/artifacts", {
    query: LocationQuery,
    payload: Artifact.CreateInput,
    success: Location.response(Artifact.Info),
    error: [InvalidRequestError, ProviderNotFoundError, SessionNotFoundError, ...commonErrors],
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(
      annotations(
        "create",
        "Create artifact",
        "Publish a new artifact through the selected or default artifact provider.",
      ),
    ),
  HttpApiEndpoint.get("artifacts.get", "/api/experimental/artifacts/:artifactID", {
    params,
    query: LocationQuery,
    success: Location.response(Artifact.Content),
    error: itemErrors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(annotations("get", "Read artifact", "Read an artifact's metadata and file contents.")),
  HttpApiEndpoint.patch("artifacts.update", "/api/experimental/artifacts/:artifactID", {
    params,
    query: LocationQuery,
    payload: Artifact.UpdateInput,
    success: Location.response(Artifact.Info),
    error: [InvalidRequestError, SessionNotFoundError, ...itemErrors],
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(annotations("update", "Update artifact", "Replace an artifact's files at the same ID and URL.")),
  HttpApiEndpoint.delete("artifacts.delete", "/api/experimental/artifacts/:artifactID", {
    params,
    query: LocationQuery,
    success: HttpApiSchema.NoContent,
    error: itemErrors,
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(annotations("delete", "Delete artifact", "Remove an artifact and its stored files.")),
  HttpApiEndpoint.get("artifacts.view", "/api/experimental/artifacts/:artifactID/view/*", {
    params,
    query: LocationQuery,
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
    error: [FileNotFoundError, InvalidRequestError, ...itemErrors],
  })
    .annotateMerge(locationQueryOpenApi)
    .annotateMerge(annotations("view", "View local artifact", "Serve HTML and static files from the local provider.")),
] as const
