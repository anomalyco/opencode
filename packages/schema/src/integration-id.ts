import { brand } from "./brand.js"
import { Schema } from "effect"

export const IntegrationID = Schema.String.pipe(brand("Integration.ID"))
export type IntegrationID = typeof IntegrationID.Type

export const IntegrationMethodID = Schema.String.pipe(brand("Integration.MethodID"))
export type IntegrationMethodID = typeof IntegrationMethodID.Type
