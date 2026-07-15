import type {
  BackgroundDefinition,
  FormfieldColorDefinition,
  ModeDefinition,
  StatefulColorDefinition,
  TextDefinition,
  ThemeTokensDefinition,
} from "./index"
import { ActionState, FormfieldState } from "./schema"

export function expandTheme<Definition extends ModeDefinition>(definition: Definition): Definition {
  return {
    ...definition,
    ...expandTokens(definition),
    ...Object.fromEntries(
      Object.entries(definition)
        .filter(([key]) => key.startsWith("@context:"))
        .map(([key, value]) => [key, expandTokens(value as ThemeTokensDefinition)]),
    ),
  }
}

export function expandTokens(definition: ThemeTokensDefinition): ThemeTokensDefinition {
  return {
    ...definition,
    text: expandText(definition.text),
    background: expandBackground(definition.background),
  }
}

export function mergeTheme(...values: unknown[]): Record<string, unknown> {
  return values.reduce<Record<string, unknown>>((result, value) => {
    if (!isRecord(value)) return result
    return Object.entries(value).reduce<Record<string, unknown>>((next, [key, item]) => {
      if (item === undefined || key === "mergeMode") return next
      return {
        ...next,
        [key]: isRecord(item) ? mergeTheme(next[key], item) : item,
      }
    }, result)
  }, {})
}

function expandText(definition: TextDefinition | undefined): TextDefinition | undefined {
  if (!definition) return
  return {
    ...definition,
    subdued: definition.subdued ?? (definition.default ? "$text.default" : undefined),
    action: expandActions(definition.action, "text.action"),
    formfield: expandFormfield(definition.formfield, "text.formfield"),
    feedback: definition.feedback
      ? Object.fromEntries(
          Object.entries(definition.feedback).map(([kind, feedback]) => {
            return [
              kind,
              {
                ...feedback,
                subdued: feedback.subdued ?? (feedback.default ? `$text.feedback.${kind}.default` : undefined),
              },
            ]
          }),
        )
      : undefined,
  }
}

function expandBackground(definition: BackgroundDefinition | undefined): BackgroundDefinition | undefined {
  if (!definition) return
  return {
    ...definition,
    action: expandActions(definition.action, "background.action"),
    formfield: expandFormfield(definition.formfield, "background.formfield"),
  }
}

function expandFormfield(definition: FormfieldColorDefinition | undefined, path: string) {
  if (!definition?.default) return definition
  return {
    ...definition,
    ...Object.fromEntries(
      FormfieldState.literals.map((state) => [`$${state}`, definition[`$${state}`] ?? `$${path}.default`]),
    ),
  }
}

function expandActions<Definition extends Partial<Record<string, StatefulColorDefinition>>>(
  definition: Definition | undefined,
  path: string,
) {
  if (!definition) return
  return Object.fromEntries(
    Object.entries(definition).map(([variant, value]) => {
      if (!value?.default) return [variant, value]
      return [
        variant,
        {
          ...value,
          ...Object.fromEntries(
            ActionState.literals.map((state) => [`$${state}`, value[`$${state}`] ?? `$${path}.${variant}.default`]),
          ),
        },
      ]
    }),
  ) as Definition
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
