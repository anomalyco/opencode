import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@/util/effect-zod"
import { Newtype } from "@/util/schema"

export class SecureInputID extends Newtype<SecureInputID>()(
  "SecureInputID",
  Schema.String.annotate({ [ZodOverride]: Identifier.schema("secureinput") }),
) {
  static ascending(id?: string): SecureInputID {
    return this.make(Identifier.ascending("secureinput", id))
  }

  static readonly zod = zod(this)
}
