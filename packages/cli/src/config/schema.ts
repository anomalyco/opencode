import { Config } from "@opencode-ai/tui/config"
import { Schema } from "effect"

export const Info = Schema.Struct({ ...Config.Info.fields })
export type Info = Schema.Schema.Type<typeof Info>
