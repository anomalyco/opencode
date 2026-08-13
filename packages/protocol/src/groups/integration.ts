import { Integration } from "@opencode-ai/schema/integration"
import { Location } from "@opencode-ai/schema/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

const Inputs = Schema.Record(Schema.String, Schema.String)

export const IntegrationGroup = HttpApiGroup.make("server.integration")
  .add(
    HttpApiEndpoint.get("integration.list", "/api/integration", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Integration.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.list",
          summary: "List integrations",
          description: "Retrieve available integrations and their authentication methods.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("integration.get", "/api/integration/:integrationID", {
      params: { integrationID: Integration.ID },
      query: LocationQuery,
      success: Location.response(Schema.UndefinedOr(Integration.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.get",
          summary: "Get integration",
          description: "Retrieve one integration and its authentication methods.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("integration.connect.key", "/api/integration/:integrationID/connect/key", {
      params: { integrationID: Integration.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        key: Schema.String,
        label: Schema.optional(Schema.String),
      }),
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.connect.key",
          summary: "Connect with key",
          description: "Run a key authentication method and store the resulting credential.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("integration.connect.oauth", "/api/integration/:integrationID/connect/oauth", {
      params: { integrationID: Integration.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        methodID: Integration.MethodID,
        inputs: Inputs,
        label: Schema.optional(Schema.String),
      }),
      success: Location.response(Integration.Attempt),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.connect.oauth",
          summary: "Begin OAuth connection",
          description: "Start an OAuth attempt and return the authorization details.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("integration.attempt.status", "/api/integration/attempt/:attemptID", {
      params: { attemptID: Integration.AttemptID },
      query: LocationQuery,
      success: Location.response(Integration.AttemptStatus),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.attempt.status",
          summary: "Get OAuth attempt status",
          description: "Poll the current status of an OAuth attempt.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("integration.attempt.complete", "/api/integration/attempt/:attemptID/complete", {
      params: { attemptID: Integration.AttemptID },
      query: LocationQuery,
      payload: Schema.Struct({ code: Schema.optional(Schema.String) }),
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.attempt.complete",
          summary: "Complete OAuth connection",
          description: "Complete a code-based OAuth attempt and store the resulting credential.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("integration.attempt.cancel", "/api/integration/attempt/:attemptID", {
      params: { attemptID: Integration.AttemptID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.attempt.cancel",
          summary: "Cancel OAuth connection",
          description: "Cancel an OAuth attempt and release its resources.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "integrations", description: "Integration discovery and authentication routes." }),
  )
