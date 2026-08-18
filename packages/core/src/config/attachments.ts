export * as ConfigAttachments from "./attachments"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Image extends Schema.Class<Image>("ConfigV2.Attachments.Image")({
  auto_resize: Schema.Boolean.pipe(Schema.optional),
  max_width: PositiveInt.pipe(Schema.optional),
  max_height: PositiveInt.pipe(Schema.optional),
  max_base64_bytes: PositiveInt.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Attachments")({
  image: Image.pipe(Schema.optional),
}) {}
