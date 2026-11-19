import { Generate } from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import {
  ForbiddenError,
  ImageNotFoundError,
  VideoNotFoundError,
  InvalidRequestError,
  LocationNotFoundError,
  ModelNotFoundError,
  ProviderNotFoundError,
  ProviderRequestError,
  ServiceUnavailableError,
  UnsupportedModelError,
} from "../errors.js"

const errors = [
  InvalidRequestError,
  ProviderNotFoundError,
  ModelNotFoundError,
  UnsupportedModelError,
  ProviderRequestError,
  ServiceUnavailableError,
  LocationNotFoundError,
]

const textContract = {
  payload: Schema.Struct({
    prompt: Schema.String,
    model: Model.Ref.pipe(Schema.optional),
  }),
  success: Schema.Struct({
    data: Schema.Struct({ text: Schema.String }),
  }).annotate({ identifier: "GenerateTextResponse" }),
  error: errors,
}

export const GenerateGroup = HttpApiGroup.make("server.generate")
  .add(
    HttpApiEndpoint.post("generate.text", "/api/experimental/generate/text", textContract).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.generate.text",
        summary: "Generate text",
        description:
          "Run one stateless model generation using the server's base configuration and return the assistant text. Uses the base configuration's default model when none is specified.",
      }),
    ),
  )
  // Kept so clients built before the move to /generate/text keep working; omitted from generated clients.
  .add(
    HttpApiEndpoint.post("generate.textLegacy", "/api/experimental/generate", textContract).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.generate.textLegacy",
        summary: "Generate text (deprecated path)",
        description: "Deprecated alias of POST /api/experimental/generate/text.",
        deprecated: true,
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("generate.image.create", "/api/experimental/generate/image", {
      payload: Generate.ImageRequest,
      success: Schema.Struct({ data: Generate.ImageRunning }).annotate({ identifier: "GenerateImageCreateResponse" }),
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.generate.image.create",
        summary: "Create an image generation",
        description:
          "Start generating or editing images with an image model using the server's base configuration and return the job's ID at once. The server makes the request and stores the finished images as blobs; read the job with GET /api/experimental/generate/image/:id and each image with GET /api/experimental/blob/:id. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("generate.image.get", "/api/experimental/generate/image/:id", {
      params: { id: Generate.ImageID },
      success: Schema.Struct({ data: Generate.ImageJob }).annotate({ identifier: "GenerateImageGetResponse" }),
      error: [ImageNotFoundError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.generate.image.get",
        summary: "Read an image generation",
        description:
          "Read an image job: running, completed with its images' blobs, or error with a reason. A job whose server stopped mid-request fails with reason unknown 30 minutes after it started. A job is not found 24 hours after it finished, or once none of its blobs remain. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("generate.video.create", "/api/experimental/generate/video", {
      payload: Generate.VideoRequest,
      success: Schema.Struct({ data: Generate.VideoRunning }).annotate({ identifier: "GenerateVideoCreateResponse" }),
      error: [...errors, ForbiddenError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.generate.video.create",
        summary: "Create a video generation",
        description:
          "Submit a video job to a video model using the server's base configuration and return its ID once the provider accepted it. The server polls the job and stores the finished videos as blobs; read the job with GET /api/experimental/generate/video/:id and the video with GET /api/experimental/blob/:id. Behind the video_generate flag. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("generate.video.get", "/api/experimental/generate/video/:id", {
      params: { id: Generate.VideoID },
      success: Schema.Struct({ data: Generate.VideoJob }).annotate({ identifier: "GenerateVideoGetResponse" }),
      error: [VideoNotFoundError, ForbiddenError, LocationNotFoundError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.generate.video.get",
        summary: "Read a video generation",
        description:
          "Read a video job: running, completed with its videos' blobs, or error with a reason. Jobs survive a server restart, which resumes polling running ones. A job is not found 24 hours after it finished, or once none of its blobs remain. Behind the video_generate flag. Experimental: may change without compatibility guarantees.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("generate.decisions", "/api/experimental/generate/decisions", {
      payload: Generate.DecisionRequest,
      success: Schema.Struct({ data: Generate.DecisionResult }).annotate({ identifier: "GenerateDecisionsResponse" }),
      error: errors,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "experimental.generate.decisions",
        summary: "Generate decisions",
        description:
          "Ask a decision model typed predicate, choice and score questions about the input and return one probability-bearing answer per question, in question order. Stateless: nothing is stored.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "generate",
      description: "Experimental one-shot generation routes.",
    }),
  )
