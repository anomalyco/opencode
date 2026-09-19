import { Client } from "@opencode/schema/client"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { ClientNotFoundError, ConflictError } from "../errors.js"

const ClientResponse = Schema.Struct({ data: Client.Info }).annotate({ identifier: "ClientResponse" })
const ClientListResponse = Schema.Struct({ data: Schema.Array(Client.Info) }).annotate({
  identifier: "ClientListResponse",
})

export const ClientGroup = HttpApiGroup.make("server.client")
  .add(
    HttpApiEndpoint.get("client.list", "/api/client", {
      success: ClientListResponse,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "client.list",
        summary: "List clients",
        description: "List UI clients currently advertising presence on this server.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("client.register", "/api/client", {
      payload: Client.CreateInput,
      success: ClientResponse,
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "client.register",
        summary: "Register client",
        description: "Register an ephemeral UI client so session activation can target it.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("client.get", "/api/client/:clientID", {
      params: { clientID: Client.ID },
      success: ClientResponse,
      error: ClientNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "client.get",
        summary: "Get client",
        description: "Get one registered UI client.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.put("client.update", "/api/client/:clientID", {
      params: { clientID: Client.ID },
      payload: Client.UpdateInput,
      success: ClientResponse,
      error: ClientNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "client.update",
        summary: "Update client",
        description: "Update the sessions and focus state advertised by one UI client.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.delete("client.remove", "/api/client/:clientID", {
      params: { clientID: Client.ID },
      success: HttpApiSchema.NoContent,
      error: ClientNotFoundError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "client.remove",
        summary: "Remove client",
        description: "Unregister a UI client.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "client",
      description: "Ephemeral UI client presence for session activation.",
    }),
  )
