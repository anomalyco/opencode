import { Connector } from "@opencode-ai/core/connector"
import { Location } from "@opencode-ai/core/location"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"
import { LocationMiddleware, LocationQuery, locationQueryOpenApi } from "./location"

const Inputs = Schema.Record(Schema.String, Schema.String)

export const ConnectorGroup = HttpApiGroup.make("server.connector")
  .add(
    HttpApiEndpoint.get("connector.list", "/api/connector", {
      query: LocationQuery,
      success: Location.response(Schema.Array(Connector.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.connector.list",
          summary: "List connectors",
          description: "Retrieve available connectors and their authentication methods.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("connector.get", "/api/connector/:connectorID", {
      params: { connectorID: Connector.ID },
      query: LocationQuery,
      success: Location.response(Schema.UndefinedOr(Connector.Info)),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.connector.get",
          summary: "Get connector",
          description: "Retrieve one connector and its authentication methods.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("connector.connect.key", "/api/connector/:connectorID/connect/key", {
      params: { connectorID: Connector.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        methodID: Connector.MethodID,
        key: Schema.String,
        inputs: Inputs,
        label: Schema.optional(Schema.String),
      }),
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.connector.connect.key",
          summary: "Connect with key",
          description: "Run a key authentication method and store the resulting credential.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("connector.connect.oauth.begin", "/api/connector/:connectorID/connect/oauth", {
      params: { connectorID: Connector.ID },
      query: LocationQuery,
      payload: Schema.Struct({
        methodID: Connector.MethodID,
        inputs: Inputs,
        label: Schema.optional(Schema.String),
      }),
      success: Location.response(Connector.Attempt),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.connector.connect.oauth.begin",
          summary: "Begin OAuth connection",
          description: "Start an OAuth attempt and return the authorization details.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.get("connector.connect.oauth.status", "/api/connector/oauth/:attemptID", {
      params: { attemptID: Connector.AttemptID },
      query: LocationQuery,
      success: Location.response(Connector.AttemptStatus),
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.connector.connect.oauth.status",
          summary: "Get OAuth attempt status",
          description: "Poll the current status of an OAuth attempt.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("connector.connect.oauth.complete", "/api/connector/oauth/:attemptID/complete", {
      params: { attemptID: Connector.AttemptID },
      query: LocationQuery,
      payload: Schema.Struct({ code: Schema.optional(Schema.String) }),
      success: HttpApiSchema.NoContent,
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.connector.connect.oauth.complete",
          summary: "Complete OAuth connection",
          description: "Complete a code-based OAuth attempt and store the resulting credential.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.delete("connector.connect.oauth.cancel", "/api/connector/oauth/:attemptID", {
      params: { attemptID: Connector.AttemptID },
      query: LocationQuery,
      success: HttpApiSchema.NoContent,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.connector.connect.oauth.cancel",
          summary: "Cancel OAuth connection",
          description: "Cancel an OAuth attempt and release its resources.",
        }),
      ),
  )
  .annotateMerge(
    OpenApi.annotations({ title: "connectors", description: "Connector discovery and authentication routes." }),
  )
  .middleware(LocationMiddleware)
