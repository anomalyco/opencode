export * as IntegrationSchema from "./schema"

import { Schema } from "effect"

export const ID = Schema.String.pipe(Schema.brand("Integration.ID"))
export type ID = typeof ID.Type

export const MethodID = Schema.String.pipe(Schema.brand("Integration.MethodID"))
export type MethodID = typeof MethodID.Type
