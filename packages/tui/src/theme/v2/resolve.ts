import { RGBA } from "@opentui/core"
import { Schema } from "effect"
import { DEFAULT_THEME } from "./defaults"
import { expandTheme, expandTokens, mergeTheme } from "./expand"
import { fallback } from "./fallback"
import {
  ActionState,
  ActionVariant,
  BaseHue,
  FeedbackKind,
  FormfieldState,
  HueAlias,
  HueStep,
  ThemeDefinition,
  ThemeFile,
} from "./schema"
import type {
  ActionStateKey,
  HueDefinition,
  HueScale,
  ResolvedActionState,
  ResolvedTheme,
  ResolvedThemeView,
  StatefulColorDefinition,
  ThemeTokensDefinition,
} from "./index"
import { selectTheme, selectThemeMode } from "./select"

const decodeThemeDefinitionSchema = Schema.decodeUnknownSync(ThemeDefinition)
const decodeThemeFileSchema = Schema.decodeUnknownSync(ThemeFile)

function decodeThemeDefinition(input: unknown) {
  try {
    return decodeThemeDefinitionSchema(input)
  } catch (error) {
    throw themeDecodeError(error, "theme")
  }
}

function decodeThemeFile(input: unknown, name: string) {
  try {
    return decodeThemeFileSchema(input)
  } catch (error) {
    throw themeDecodeError(error, name)
  }
}

function themeDecodeError(error: unknown, name: string) {
  const message = Schema.isSchemaError(error) ? error.message : String(error)
  const value = /got ("[^"]*"|\S+)/.exec(message)?.[1] ?? "value"
  return new Error(`Invalid theme: ${name} ${value} is an invalid value`, { cause: error })
}

export function resolveThemeFile(file: ThemeFile, mode?: "light" | "dark", name = "theme") {
  const decoded = decodeThemeFile(file, name)
  const selected = selectThemeMode(decoded, mode)
  const definition = selected.expanded ? selected.theme : expandTheme(selected.theme)
  const defaults = expandTheme(selectTheme(DEFAULT_THEME, selected.mode))
  const core = expandTokens(fallback())
  const merged = decoded.standalone
    ? mergeTheme(core, definition)
    : mergeTheme(core, defaults, definition)
  if (!merged["hue"]) throw new Error("Standalone themes must provide hues")
  return resolveExpandedTheme(merged as ThemeDefinition)
}

export function resolveTheme(definition: ThemeDefinition): ResolvedTheme {
  return resolveExpandedTheme(expandTheme(decodeThemeDefinition(definition)))
}

function resolveExpandedTheme(definition: ThemeDefinition): ResolvedTheme {
  const hue = resolveHue(definition.hue)
  const base = tokens(definition)
  const resolved = resolveView(base, hue)
  const contexts = Object.fromEntries(
    Object.entries(definition)
      .filter(([key]) => key.startsWith("@context:"))
      .map(([key, override]) => {
        const contextual = contextualize(base, override as ThemeTokensDefinition)
        return [key, resolveView(contextual, hue)]
      }),
  )

  return { ...resolved, contexts } as ResolvedTheme
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
  const baseText = base.text?.action
  const contextText = override.text?.action
  const baseBackground = base.background?.action
  const contextBackground = override.background?.action
  const text = result["text"] as NonNullable<ThemeTokensDefinition["text"]>
  const background = result["background"] as NonNullable<ThemeTokensDefinition["background"]>
  return {
    ...result,
    text: { ...text, action: contextualActions(baseText, contextText) },
    background: { ...background, action: contextualActions(baseBackground, contextBackground) },
  } as ThemeTokensDefinition
}

function contextualActions(
  base: Partial<Record<ActionVariant, StatefulColorDefinition>> | undefined,
  context: Partial<Record<ActionVariant, StatefulColorDefinition>> | undefined,
) {
  return Object.fromEntries(
    ActionVariant.literals.map((variant) => {
      const baseVariant = base?.[variant]
      const contextVariant = context?.[variant]
      return [
        variant,
        Object.fromEntries(
          (["default", ...ActionState.literals] as readonly ResolvedActionState[]).map((state) => {
            const key = state === "default" ? undefined : (`$${state}` as ActionStateKey)
            return [
              key ?? "default",
              (key ? contextVariant?.[key] : undefined) ??
                contextVariant?.default ??
                (key ? baseVariant?.[key] : undefined) ??
                baseVariant?.default,
            ]
          }),
        ),
      ]
    }),
  )
}

function resolveView(definition: ThemeTokensDefinition, hue: ResolvedThemeView["hue"]): ResolvedThemeView {
  const source: Record<string, unknown> = { hue, ...definition }
  return { ...(createResolver(source)(source, "theme") as ResolvedThemeView), hue }
}

function resolveHue(definition: HueDefinition) {
  const source = definition as Record<string, unknown>
  const cache = new Map<string, HueScale>()
  const expected = new Set<string>([...BaseHue.literals, ...HueAlias.literals])
  for (const name of Object.keys(source)) {
    if (!expected.has(name)) throw new Error(`Unknown hue "${name}"`)
  }

  function resolve(name: string, stack: string[]): HueScale {
    const hit = cache.get(name)
    if (hit) return hit
    if (stack.includes(name)) throw new Error(`Circular hue reference: ${[...stack, name].join(" -> ")}`)
    const value = source[name]
    if (typeof value === "string") {
      if ((BaseHue.literals as readonly string[]).includes(name)) throw new Error(`Base hue "${name}" must be a scale`)
      const match = /^\$hue\.([^.]+)$/.exec(value)
      if (!match?.[1]) throw new Error(`Hue alias "${value}" must reference a hue scale`)
      const result = resolve(match[1], [...stack, name])
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
      if (!HueStep.literals.includes(Number(step) as HueStep)) throw new Error(`Unknown hue step at "hue.${name}.${step}"`)
    }
    cache.set(name, result)
    return result
  }

  return Object.fromEntries(
    [...BaseHue.literals, ...HueAlias.literals].map((name) => [name, resolve(name, [])]),
  ) as ResolvedThemeView["hue"]
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
    const result = resolve(read(source, target), target, [...stack, target])
    if (!(result instanceof RGBA)) throw new Error(`Theme reference "${value}" at "${path}" is not a color`)
    cache.set(target, result)
    return result
  }

  return (value: unknown, path: string) => resolve(value, path)
}

function resolvedKey(key: string) {
  if (!key.startsWith("$")) return key
  const state = key.slice(1)
  return ([...ActionState.literals, ...FormfieldState.literals] as readonly string[]).includes(state) ? state : key
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
