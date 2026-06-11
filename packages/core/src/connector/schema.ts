export * as ConnectorSchema from "./schema"

import { Schema } from "effect"

export const ID = Schema.String.pipe(Schema.brand("Connector.ID"))
export type ID = typeof ID.Type

export const MethodID = Schema.String.pipe(Schema.brand("Connector.MethodID"))
export type MethodID = typeof MethodID.Type
