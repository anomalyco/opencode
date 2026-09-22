import { RGBA } from "@opentui/core"
import { Schema } from "effect"
import { expandTheme, mergeTheme } from "./expand.js"
import {
  ActionState,
  ActionVariant,
  HueStep,
  SurfaceName,
  ThemeDefinition,
  ThemeDocument,
} from "./schema.js"
import type {
  ActionStateKey,
  ActionStates,
  HueScale,
  Mode,
  ResolvedActionState,
  ResolvedTheme,
  ResolvedThemeTokens,
  StatefulColor,
  StatefulColorDefinition,
  ThemeTokensDefinition,
} from "./index.js"
import { selectThemeMode, themeModes } from "./select.js"

const decodeThemeDefinitionSchema = Schema.decodeUnknownSync(ThemeDefinition, { reportInput: true })
const decodeThemeDocumentSchema = Schema.decodeUnknownSync(ThemeDocument, { reportInput: true })

function decodeThemeDefinition(input: unknown) {
  try {
    return decodeThemeDefinitionSchema(input)
  } catch (error) {
    throw themeDecodeError(error, "theme")
  }
}

export function themeDecodeError(error: unknown, name: string) {
  const message = Schema.isSchemaError(error) ? error.message : String(error)
  const value = /got ("[^"]*"|\S+)/.exec(message)?.[1] ?? "value"
  return new Error(`Invalid theme: ${name} ${value} is an invalid value`, { cause: error })
}

export function parseThemeDocument(input: unknown, name = "theme") {
  try {
    const document = decodeThemeDocumentSchema(input)
    themeModes(document).forEach((mode) => resolveThemeDocument(document, mode))
    return document
  } catch (error) {
    throw themeDecodeError(error, name)
  }
}

export function resolveThemeDocument(document: ThemeDocument, mode?: Mode) {
  const selected = selectThemeMode(document, mode)
  const definition = expandTheme(selected.theme)
  return resolveExpandedTheme(definition)
}

export function resolveTheme(definition: ThemeDefinition): ResolvedTheme {
  return resolveExpandedTheme(expandTheme(decodeThemeDefinition(definition)))
}

function resolveExpandedTheme(definition: ThemeDefinition): ResolvedTheme {
  const hue = resolveHue(definition.hue)
  const categorical = definition.categorical.map((name) => {
    const scale = hue[name]
    if (!scale) throw new Error(`Categorical hue "${name}" was not found`)
    return scale
  })
  const hueSteps = compileHueSteps(hue)
  const base = tokens(definition)
  const views = {} as Record<SurfaceName, ResolvedTheme>
  const view = (tokens: ThemeTokensDefinition): ResolvedTheme => ({
    ...resolveView(tokens, hue, categorical, hueSteps),
    surface: (name) => views[name],
  })
  views.dialog = definition["@dialog"] ? view(contextualize(base, definition["@dialog"])) : view(base)
  return view(base)
}

function tokens(definition: ThemeDefinition): ThemeTokensDefinition {
  return {
    text: definition.text,
    background: definition.background,
    border: definition.border,
    scrollbar: definition.scrollbar,
    diff: definition.diff,
    syntax: definition.syntax,
    markdown: definition.markdown,
  }
}

function contextualize(base: ThemeTokensDefinition, override: ThemeTokensDefinition) {
  const result = mergeTheme(base, override)
  const text = result["text"] as NonNullable<ThemeTokensDefinition["text"]>
  const background = result["background"] as NonNullable<ThemeTokensDefinition["background"]>
  return {
    ...result,
    text: { ...text, action: contextualActions(base.text?.action, override.text?.action) },
    background: { ...background, action: contextualActions(base.background?.action, override.background?.action) },
  } as ThemeTokensDefinition
}

function contextualActions(
  base: Partial<Record<ActionVariant, StatefulColorDefinition>> | undefined,
  surface: Partial<Record<ActionVariant, StatefulColorDefinition>> | undefined,
) {
  return Object.fromEntries(
    ActionVariant.literals.map((variant) => {
      const baseVariant = base?.[variant]
      const surfaceVariant = surface?.[variant]
      return [
        variant,
        Object.fromEntries(
          (["base", ...ActionState.literals] as readonly ResolvedActionState[]).map((state) => {
            const key = state === "base" ? undefined : (`$${state}` as ActionStateKey)
            return [
              key ?? "base",
              (key ? surfaceVariant?.[key] : undefined) ??
                surfaceVariant?.base ??
                (key ? baseVariant?.[key] : undefined) ??
                baseVariant?.base,
            ]
          }),
        ),
      ]
    }),
  )
}

function resolveView(
  definition: ThemeTokensDefinition,
  hue: ResolvedThemeTokens["hue"],
  categorical: ResolvedThemeTokens["categorical"],
  hueSteps: Pick<ResolvedThemeTokens, "source" | "increase" | "decrease">,
): ResolvedThemeTokens {
  const source: Record<string, unknown> = { hue, ...definition }
  const resolved = createResolver(source)(source, "theme") as ResolvedThemeTokens
  return {
    ...resolved,
    hue,
    categorical,
    text: {
      ...resolved.text,
      action: statefulActions(resolved.text.action),
      formfield: statefulColor(resolved.text.formfield),
    },
    background: {
      ...resolved.background,
      action: statefulActions(resolved.background.action),
      formfield: statefulColor(resolved.background.formfield),
    },
    ...hueSteps,
  }
}

function statefulActions(actions: Readonly<Record<ActionVariant, StatefulColor>>) {
  return Object.fromEntries(ActionVariant.literals.map((variant) => [variant, statefulColor(actions[variant])])) as Readonly<
    Record<ActionVariant, StatefulColor>
  >
}

function statefulColor(color: StatefulColor): StatefulColor {
  return {
    ...color,
    state: (states: ActionStates) => color[ActionState.literals.find((state) => states[state]) ?? "base"],
  }
}

function compileHueSteps(
  hue: ResolvedThemeTokens["hue"],
): Pick<ResolvedThemeTokens, "source" | "increase" | "decrease"> {
  const index = new WeakMap<RGBA, { hue: keyof typeof hue; step: HueStep; position: number }>()
  for (const [name, scale] of Object.entries(hue) as [keyof typeof hue, HueScale][]) {
    HueStep.literals.forEach((step, position) => index.set(scale[step], { hue: name, step, position }))
  }
  const shift = (color: RGBA, amount: number) => {
    const match = index.get(color)
    if (!match) return color
    const offset = Number.isFinite(amount) ? Math.trunc(amount) : 0
    const position = Math.max(0, Math.min(HueStep.literals.length - 1, match.position + offset))
    return hue[match.hue][HueStep.literals[position]]
  }
  return {
    source: (color) => {
      const match = index.get(color)
      return match ? { hue: match.hue, step: match.step } : undefined
    },
    increase: (color, amount = 1) => shift(color, amount),
    decrease: (color, amount = 1) => shift(color, -amount),
  }
}

function resolveHue(definition: ThemeDefinition["hue"]) {
  const source = definition as Record<string, unknown>
  const cache = new Map<string, HueScale>()

  function resolve(name: string, stack: string[]): HueScale {
    const hit = cache.get(name)
    if (hit) return hit
    if (stack.includes(name)) throw new Error(`Circular hue reference: ${[...stack, name].join(" -> ")}`)
    const value = source[name]
    if (typeof value === "string") {
      const match = /^\$hue\.(.+)$/.exec(value)
      if (!match?.[1]) throw new Error(`Hue alias "${value}" must reference a hue scale`)
      if (source[match[1]] === undefined) throw new Error(`Hue alias "${value}" references a missing hue`)
      const target = resolve(match[1], [...stack, name])
      const result = Object.fromEntries(HueStep.literals.map((step) => [step, RGBA.clone(target[step])])) as HueScale
      cache.set(name, result)
      return result
    }
    if (!isRecord(value)) throw new Error(`Hue "${name}" was not found`)
    const result = Object.fromEntries(
      HueStep.literals.map((step) => {
        const color = value[step]
        if (typeof color !== "string" || !isHex(color)) throw new Error(`Invalid hue color at "hue.${name}.${step}"`)
        return [step, RGBA.fromHex(color)]
      }),
    ) as HueScale
    for (const step of Object.keys(value)) {
      if (!HueStep.literals.includes(Number(step) as HueStep))
        throw new Error(`Unknown hue step at "hue.${name}.${step}"`)
    }
    cache.set(name, result)
    return result
  }

  return Object.fromEntries(Object.keys(source).map((name) => [name, resolve(name, [])])) as ResolvedThemeTokens["hue"]
}

function createResolver(source: Record<string, unknown>) {
  const cache = new Map<string, RGBA>()

  function resolve(value: unknown, path: string, stack: string[] = []): unknown {
    if (value instanceof RGBA) return value
    if (typeof value === "string") return resolveColor(value, path, stack)
    if (typeof value === "number") return value
    if (!isRecord(value)) throw new Error(`Invalid theme value at "${path}"`)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [resolvedKey(key), resolve(item, `${path}.${key}`, stack)]),
    )
  }

  function resolveColor(value: string, path: string, stack: string[]) {
    if (value === "transparent") return RGBA.fromInts(0, 0, 0, 0)
    if (isHex(value)) return RGBA.fromHex(value)
    if (!value.startsWith("$")) throw new Error(`Invalid color "${value}" at "${path}"`)
    const target = value.slice(1)
    const hit = cache.get(target)
    if (hit) return hit
    if (stack.includes(target)) throw new Error(`Circular theme reference: ${[...stack, target].join(" -> ")}`)
    const result = resolve(readColor(source, target), target, [...stack, target])
    if (!(result instanceof RGBA)) throw new Error(`Theme reference "${value}" at "${path}" is not a color`)
    cache.set(target, result)
    return result
  }

  return (value: unknown, path: string) => resolve(value, path)
}

function readColor(source: Record<string, unknown>, path: string) {
  const match = /^hue\.(.+)\.(100|200|300|400|500|600|700|800|900)$/.exec(path)
  if (!match?.[1] || !match[2]) return read(source, path)
  const scales = source.hue
  const scale = isRecord(scales) ? scales[match[1]] : undefined
  const color = isRecord(scale) ? scale[match[2]] : undefined
  if (color === undefined) throw new Error(`Theme reference "$${path}" was not found`)
  return color
}

function resolvedKey(key: string) {
  if (!key.startsWith("$")) return key
  const state = key.slice(1)
  return (ActionState.literals as readonly string[]).includes(state) ? state : key
}

function read(source: Record<string, unknown>, path: string) {
  const result = path.split(".").reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), source)
  if (result === undefined) throw new Error(`Theme reference "$${path}" was not found`)
  return result
}

function isHex(value: string) {
  return /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof RGBA)
}
