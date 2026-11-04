export * as ConfigMedia from "./media.js"

import { Schema } from "effect"
import { optional, PositiveInt } from "../schema.js"

export class Image extends Schema.Class<Image>("Config.Media.Image")({
  auto_resize: Schema.Boolean.pipe(optional),
  max_width: PositiveInt.pipe(optional),
  max_height: PositiveInt.pipe(optional),
  max_base64_bytes: PositiveInt.pipe(optional),
  max_images: PositiveInt.pipe(optional).annotate({
    description:
      "Cap the number of image attachments replayed per model request. Oldest images beyond the cap are replaced with a text placeholder that names the original file, so a tool can still read it back. Keep it within your provider's per-request image limit (for example 4 for vLLM's --limit-mm-per-prompt). Unset means no count-based cap.",
  }),
}) {}

export class Info extends Schema.Class<Info>("Config.Media")({
  image: Image.pipe(optional),
}) {}
