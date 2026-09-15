export * as ConfigPluginV1 from "./plugin"

import { Schema } from "effect"

export const Options = Schema.Record(Schema.String, Schema.Unknown)
export type Options = Schema.Schema.Type<typeof Options>

export const Spec = Schema.Union([Schema.String, Schema.mutable(Schema.Tuple([Schema.String, Options]))])
export type Spec = Schema.Schema.Type<typeof Spec>
