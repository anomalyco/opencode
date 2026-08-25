import { Agent } from "@opencode-ai/schema/agent"
import { Location } from "@opencode-ai/schema/location"
import { RelativePath } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError } from "../errors"
import { LocationQuery, locationQueryOpenApi } from "./location"

const ContextSource = Schema.Struct({
  key: Schema.String,
  kind: Schema.Literals(["system", "instructions", "environment", "skills", "references"]),
  title: Schema.String,
  path: Schema.optional(RelativePath),
  editable: Schema.Boolean,
  content: Schema.String,
}).annotate({ identifier: "ContextSource" })

const InspectQuery = Schema.Struct({
  ...LocationQuery.fields,
  agent: Schema.optional(Agent.ID),
}).annotate({ identifier: "ContextInspectQuery" })

const WriteInstructionPayload = Schema.Struct({
  path: RelativePath,
  content: Schema.String,
}).annotate({ identifier: "ContextWriteInstructionPayload" })

export const ContextGroup = HttpApiGroup.make("server.context")
  .add(
    HttpApiEndpoint.get("context.inspect", "/api/context", {
      query: InspectQuery,
      success: Location.response(Schema.Array(ContextSource)),
      error: InvalidRequestError,
    })
      .annotateMerge(locationQueryOpenApi)
      .annotateMerge(
        OpenApi.annotations({
          identifier: "v2.context.inspect",
          summary: "Inspect system context",
          description: "Return every source that would be sent to the model for the requested location and agent.",
        }),
      ),
  )
  .add(
    HttpApiEndpoint.post("context.writeInstruction", "/api/context/instructions", {
      payload: WriteInstructionPayload,
      success: Location.response(ContextSource),
      error: InvalidRequestError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.context.writeInstruction",
        summary: "Write instructions file",
        description: "Write an AGENTS.md file relative to the requested location.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "context",
      description: "System context inspection.",
    }),
  )
