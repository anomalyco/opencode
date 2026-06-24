export * as Agent from "./agent"

import { Schema } from "effect"

export const ID = Schema.String.pipe(Schema.brand("AgentV2.ID"))
export type ID = typeof ID.Type
