import { Integration } from "@opencode-ai/schema/integration"
import { Location } from "@opencode-ai/schema/location"
import { Form } from "@opencode-ai/schema/form"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors.js"
import { LocationQuery, locationQueryOpenApi } from "./location.js"

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
    HttpApiEndpoint.post("integration.wellknown.add", "/api/experimental/integration/wellknown", {
      query: LocationQuery,
      payload: Schema.Struct({ url: Schema.String }),
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.experimental.integration.wellknown.add",
          summary: "Add wellknown integration",
          description: "Discover and persist an experimental wellknown integration source.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("integration.connect.key", "/api/integration/:integrationID/connect/key", {
      params: { integrationID: Integration.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        key: Schema.String,
        answer: Schema.optional(Form.Answer),
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
    HttpApiEndpoint.post("integration.oauth.connect", "/api/integration/:integrationID/connect/oauth", {
      params: { integrationID: Integration.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        methodID: Integration.MethodID,
        answer: Schema.optional(Form.Answer),
        label: Schema.optional(Schema.String),
      }),
      success: Location.response(Integration.Attempt),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.oauth.connect",
          summary: "Begin OAuth connection",
          description: "Start an OAuth attempt and return the authorization details.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("integration.oauth.status", "/api/integration/:integrationID/connect/oauth/:attemptID", {
      params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
      query: LocationQuery,
      success: Location.response(Integration.AttemptStatus),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.oauth.status",
          summary: "Get OAuth attempt status",
          description: "Poll the current status of an OAuth attempt.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post(
      "integration.oauth.complete",
      "/api/integration/:integrationID/connect/oauth/:attemptID/complete",
      {
        params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
        query: LocationQuery,
        payload: Schema.Struct({ code: Schema.optional(Schema.String) }),
        success: HttpApiSchema.NoContent,
        error: InvalidRequestError,
      },
    )
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.oauth.complete",
          summary: "Complete OAuth connection",
          description: "Complete a code-based OAuth attempt and store the resulting credential.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("integration.oauth.cancel", "/api/integration/:integrationID/connect/oauth/:attemptID", {
      params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.oauth.cancel",
          summary: "Cancel OAuth connection",
          description: "Cancel an OAuth attempt and release its resources.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("integration.command.connect", "/api/integration/:integrationID/connect/command", {
      params: { integrationID: Integration.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        methodID: Integration.MethodID,
        label: Schema.optional(Schema.String),
      }),
      success: Location.response(Integration.CommandAttempt),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.command.connect",
          summary: "Begin command connection",
          description: "Start a command authentication attempt.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("integration.command.status", "/api/integration/:integrationID/connect/command/:attemptID", {
      params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
      query: LocationQuery,
      success: Location.response(Integration.CommandAttemptStatus),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.command.status",
          summary: "Get command attempt status",
          description: "Poll the current status and output of a command authentication attempt.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("integration.command.cancel", "/api/integration/:integrationID/connect/command/:attemptID", {
      params: { integrationID: Integration.ID, attemptID: Integration.AttemptID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.integration.command.cancel",
          summary: "Cancel command connection",
          description: "Cancel a command authentication attempt and terminate its process.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "integration", description: "Integration discovery and authentication routes." }),
  )
