import { SecureInput } from "@/secure-input"
import { SecureInputID } from "@/secure-input/schema"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { SecureInputNotFoundError } from "../errors"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"
import { described } from "./metadata"

const root = "/secure-input"
const SubmitPayload = Schema.Struct({
  input: Schema.String,
})

export const SecureInputApi = HttpApi.make("secure-input")
  .add(
    HttpApiGroup.make("secure-input")
      .add(
        HttpApiEndpoint.get("list", root, {
          query: WorkspaceRoutingQuery,
          success: described(Schema.Array(SecureInput.SecureInputRequest), "List of pending secure input requests"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "secure-input.list",
            summary: "List pending secure input requests",
            description: "Get all pending secure input (password) requests across all sessions.",
          }),
        ),
        HttpApiEndpoint.post("submit", `${root}/:requestID/submit`, {
          params: { requestID: SecureInputID },
          query: WorkspaceRoutingQuery,
          payload: SubmitPayload,
          success: described(Schema.Boolean, "Secure input submitted successfully"),
          error: [HttpApiError.BadRequest, SecureInputNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "secure-input.submit",
            summary: "Submit secure input",
            description: "Submit a password or other secure input for a pending request.",
          }),
        ),
        HttpApiEndpoint.post("cancel", `${root}/:requestID/cancel`, {
          params: { requestID: SecureInputID },
          query: WorkspaceRoutingQuery,
          success: described(Schema.Boolean, "Secure input cancelled successfully"),
          error: [HttpApiError.BadRequest, SecureInputNotFoundError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "secure-input.cancel",
            summary: "Cancel secure input request",
            description: "Cancel a pending secure input request.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "secure-input",
          description: "Secure input (password) routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode HttpApi",
      version: "0.0.1",
      description: "Effect HttpApi surface for instance routes.",
    }),
  )
