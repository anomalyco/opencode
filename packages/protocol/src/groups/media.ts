import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { FileNotFoundError, InvalidRequestError } from "../errors.js"

export const MediaHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)).annotate({
  identifier: "MediaHash",
})

export const MediaGroup = HttpApiGroup.make("server.media")
  .add(
    HttpApiEndpoint.get("media.get", "/api/media/:hash", {
      params: { hash: MediaHash },
      success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
      error: [FileNotFoundError, InvalidRequestError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "media.get",
        summary: "Read media blob",
        description:
          "Read a content-addressed media blob by SHA-256 hash with immutable Cache-Control, ETag, and 304 Not Modified support.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "media",
      description: "Content-addressed media blob routes.",
    }),
  )
