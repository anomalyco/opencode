import type {
  AutomaticScriptDefinition,
  ManualScriptDefinition,
  ScriptDefinition,
  ScriptDefinitionInput,
} from "./types.js"

type Defined<Definition> = Definition & {
  readonly kind: "opencode-drive/script"
}

export function defineScript(script: ManualScriptDefinition): Defined<ManualScriptDefinition>
export function defineScript(
  script: AutomaticScriptDefinition,
): Defined<AutomaticScriptDefinition>
export function defineScript(script: ScriptDefinitionInput): ScriptDefinition {
  return { ...script, kind: "opencode-drive/script" }
}

export type * from "./types.js"
