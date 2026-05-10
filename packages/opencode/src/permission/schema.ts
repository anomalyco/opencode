import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@opencode-ai/core/effect-zod"
import { Newtype } from "@opencode-ai/core/schema"

export class PermissionID extends Newtype<PermissionID>()(
  "PermissionID",
  Schema.String.check(Schema.isStartsWith("per")).annotate({ [ZodOverride]: Identifier.schema("permission") }),
) {
  static ascending(id?: string): PermissionID {
    return this.make(Identifier.ascending("permission", id))
  }

  static readonly zod = zod(this)
}
