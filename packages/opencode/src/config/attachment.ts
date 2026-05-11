export * as ConfigAttachment from "./attachment"

import { Schema } from "effect"
import { zod } from "@opencode-ai/core/effect-zod"
import { PositiveInt, withStatics } from "@opencode-ai/core/schema"

export const Image = Schema.Struct({
  auto_resize: Schema.optional(Schema.Boolean).annotate({
    description: "Resize images before sending them to the model when they exceed configured limits (default: true)",
  }),
  max_width: Schema.optional(PositiveInt).annotate({
    description: "Maximum image width before resizing or rejecting the attachment (default: 2000)",
  }),
  max_height: Schema.optional(PositiveInt).annotate({
    description: "Maximum image height before resizing or rejecting the attachment (default: 2000)",
  }),
  max_base64_bytes: Schema.optional(PositiveInt).annotate({
    description: "Maximum base64 payload bytes for an image attachment (default: 4718592)",
  }),
})
  .annotate({ identifier: "ImageAttachmentConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Image = Schema.Schema.Type<typeof Image>

export const Info = Schema.Struct({
  image: Schema.optional(Image).annotate({ description: "Image attachment configuration" }),
})
  .annotate({ identifier: "AttachmentConfig" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>
