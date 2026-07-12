export * as TuiKeybind from "./keybind"

import { Schema } from "effect"

export const KeybindOverrides = Schema.Struct({})
export type KeybindOverrides = Schema.Schema.Type<typeof KeybindOverrides>
