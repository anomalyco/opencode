import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { zod } from "@octopus-ai/core/effect-zod"
import { Newtype } from "@octopus-ai/core/schema"

export class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String.check(Schema.isStartsWith("que"))) {
  static ascending(id?: string): QuestionID {
    return this.make(Identifier.ascending("question", id))
  }

  static readonly zod = zod(this)
}
