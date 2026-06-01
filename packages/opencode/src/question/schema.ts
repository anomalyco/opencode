import { Schema } from "effect"

import { Identifier } from "@/id/id"
import { Newtype } from "@opencode-ai/core/schema"

export class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String.check(Schema.isStartsWith("que"))) {
  static ascending(id?: string): QuestionID {
    return this.make(Identifier.ascending("question", id))
  }
}
