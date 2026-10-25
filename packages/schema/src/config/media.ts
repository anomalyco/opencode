export * as ConfigMedia from "./media.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../schema.js"

export class Image extends Schema.Class<Image>("Config.Media.Image")({
  auto_resize: Schema.Boolean.pipe(optional),
  max_width: PositiveInt.pipe(optional),
  max_height: PositiveInt.pipe(optional),
  max_base64_bytes: PositiveInt.pipe(optional),
}) {}

export class Info extends Schema.Class<Info>("Config.Media")({
  image: Image.pipe(optional),
}) {}
