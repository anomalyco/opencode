import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod } from "@octopus-ai/core/effect-zod"
import { Newtype } from "@octopus-ai/core/schema"

export class PermissionID extends Newtype<PermissionID>()(
  "PermissionID",
  Schema.String.check(Schema.isStartsWith("per")),
) {
  static ascending(id?: string): PermissionID {
    return this.make(Identifier.ascending("permission", id))
  }

  static readonly zod = zod(this)
}
