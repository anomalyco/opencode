import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { Newtype } from "@/util/schema"

export class PermissionID extends Newtype<PermissionID>()("PermissionID", Schema.String) {
  static ascending(id?: string): PermissionID {
    return this.make(Identifier.ascending("permission", id))
  }

  static readonly zod = Identifier.schema("permission") as unknown as z.ZodType<PermissionID>
}
