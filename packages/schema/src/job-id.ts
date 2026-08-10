import { Schema } from "effect"
import { ascending } from "./identifier.js"
import { statics } from "./schema.js"

export const JobID = Schema.String.check(Schema.isStartsWith("job_")).pipe(
  Schema.brand("JobID"),
  statics((schema) => ({ create: () => schema.make("job_" + ascending()) })),
)
export type JobID = typeof JobID.Type
