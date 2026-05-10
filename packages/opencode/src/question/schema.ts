import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@opencode-ai/core/effect-zod"
import { Newtype } from "@opencode-ai/core/schema"

export class QuestionID extends Newtype<QuestionID>()(
  "QuestionID",
  Schema.String.check(Schema.isStartsWith("que")).annotate({ [ZodOverride]: Identifier.schema("question") }),
) {
  static ascending(id?: string): QuestionID {
    return this.make(Identifier.ascending("question", id))
  }

  static readonly zod = zod(this)
}
