import { Model } from "@opencode-ai/schema/model"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { InvalidRequestError, ServiceUnavailableError } from "../errors.js"

export const GenerateGroup = HttpApiGroup.make("server.generate")
  .add(
    HttpApiEndpoint.post("generate.text", "/api/generate", {
      payload: Schema.Struct({
        prompt: Schema.String,
        model: Model.Ref.pipe(Schema.optional),
      }),
      success: Schema.Struct({
        data: Schema.Struct({ text: Schema.String }),
      }).annotate({ identifier: "GenerateTextResponse" }),
      error: [InvalidRequestError, ServiceUnavailableError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.generate.text",
        summary: "Generate text",
        description:
          "Run one stateless model generation using the server's base configuration and return the assistant text. Uses the base configuration's default model when none is specified.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "generate",
      description: "Experimental one-shot generation routes.",
    }),
  )
