export * as ConfigCommandsV1 from "./commands"

import { Schema } from "effect"

export const Info = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional paths to command folders",
  }),
})
export type Info = Schema.Schema.Type<typeof Info>
