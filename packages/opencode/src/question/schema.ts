import { Schema } from "effect"
import z from "zod"

import { Identifier } from "@/id/id"
import { Newtype } from "@/util/schema"

export class QuestionID extends Newtype<QuestionID>()("QuestionID", Schema.String) {
  static ascending(id?: string): QuestionID {
    return this.make(Identifier.ascending("question", id))
  }

  static readonly zod = Identifier.schema("question") as unknown as z.ZodType<QuestionID>
}
