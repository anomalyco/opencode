export * as ConfigAttachmentV1 from "./attachment"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

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
    description: "Maximum base64 payload bytes for an image attachment (default: 5242880)",
  }),
}).annotate({ identifier: "ImageAttachmentConfig" })
export type Image = Schema.Schema.Type<typeof Image>

export const Info = Schema.Struct({
  image: Schema.optional(Image).annotate({ description: "Image attachment configuration" }),
  save_to_disk: Schema.optional(Schema.Boolean).annotate({
    description: "Save attachments to disk on receipt (default: true)",
  }),
  save_to_disk_path: Schema.optional(Schema.String).annotate({
    description: "Target directory for saved attachments (default: {Global.Path.tmp}/attachments)",
  }),
}).annotate({ identifier: "AttachmentConfig" })
export type Info = Schema.Schema.Type<typeof Info>
