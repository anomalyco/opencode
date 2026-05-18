import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { Newtype } from "@opencode-ai/core/schema"

export class PermissionID extends Newtype<PermissionID>()(
  "PermissionID",
  Schema.String.check(Schema.isStartsWith("per")),
) {
  static ascending(id?: string): PermissionID {
    return this.make(Identifier.ascending("permission", id))
  }
}
