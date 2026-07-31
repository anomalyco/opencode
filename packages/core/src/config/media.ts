export * as ConfigMedia from "./media"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Image extends Schema.Class<Image>("Config.Media.Image")({
  auto_resize: Schema.Boolean.pipe(Schema.optional),
  max_width: PositiveInt.pipe(Schema.optional),
  max_height: PositiveInt.pipe(Schema.optional),
  max_base64_bytes: PositiveInt.pipe(Schema.optional),
}) {}

export class Info extends Schema.Class<Info>("Config.Media")({
  image: Image.pipe(Schema.optional),
}) {}
