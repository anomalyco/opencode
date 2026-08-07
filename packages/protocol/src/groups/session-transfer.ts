import { Location } from "@opencode-ai/schema/location"
import { Session } from "@opencode-ai/schema/session"
import { SessionTransfer } from "@opencode-ai/schema/session-transfer"
import { Schema, SchemaGetter } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { ConflictError, SessionNotFoundError, UnknownError } from "../errors.js"

const BooleanFromString = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value): "true" | "false" => (value ? "true" : "false")),
  }),
)

export const SessionTransferGroup = HttpApiGroup.make("server.sessionTransfer")
  .add(
    HttpApiEndpoint.post("sessionTransfer.import", "/api/session/import", {
      payload: Schema.Struct({
        ...SessionTransfer.Data.fields,
        location: Location.Ref.pipe(Schema.optional),
      }),
      success: Schema.Struct({ data: Session.Info }),
      error: ConflictError,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.sessionTransfer.import",
        summary: "Import session",
        description: "Import a projected session transcript at the requested location.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("sessionTransfer.export", "/api/session/:sessionID/export", {
      params: { sessionID: Session.ID },
      query: Schema.Struct({ sanitize: BooleanFromString.pipe(Schema.optional) }),
      success: Schema.Struct({ data: SessionTransfer.Data }),
      error: [SessionNotFoundError, UnknownError],
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.sessionTransfer.export",
        summary: "Export session",
        description: "Export a complete projected session transcript.",
      }),
    ),
  )
