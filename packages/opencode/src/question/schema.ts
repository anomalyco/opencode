import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@/util/effect-zod"
import { Newtype } from "@/util/schema"

export class QuestionID extends Newtype<QuestionID>()(
  "QuestionID",
  Schema.String.annotate({ [ZodOverride]: Identifier.schema("question") }),
) {
  static ascending(id?: string): QuestionID {
    return this.make(Identifier.ascending("question", id))
  }

  static readonly zod = zod(this)
}
