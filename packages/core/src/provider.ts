export * as ProviderV2 from "./provider"

import { Effect, Schema } from "effect"
import { Provider } from "@opencode-ai/schema/provider"
import type { ProviderPackageDefinition } from "@opencode-ai/ai"
import { Npm } from "./npm"
import type { DeepMutable } from "./schema"
import { importModule, resolveModule } from "#runtime-import"

export const ID = Provider.ID
export type ID = typeof ID.Type

export const AISDK_PREFIX = "aisdk:"
export const isAISDK = (value: string | undefined): value is string => value?.startsWith(AISDK_PREFIX) ?? false
export const aisdk = (value: string) => (isAISDK(value) ? value : `${AISDK_PREFIX}${value}`)
export function packageName(value: string): string
export function packageName(value: undefined): undefined
export function packageName(value: string | undefined): string | undefined
export function packageName(value: string | undefined) {
  if (value === undefined || !isAISDK(value)) return value
  return value.slice(AISDK_PREFIX.length)
}

type Json = Schema.Schema.Type<typeof Schema.Json>
const JsonRecord = Schema.Record(Schema.String, Schema.Json)
const decodeJsonRecord = Schema.decodeUnknownSync(JsonRecord)

export class LoadError extends Schema.TaggedErrorClass<LoadError>()("ProviderV2.LoadError", {
  package: Schema.String,
  cause: Schema.Defect(),
}) {}
export type ProviderPackage = ProviderPackageDefinition

const packages = new Map<string, Promise<unknown>>()
const builtins = new Map<string, () => Promise<unknown>>([
  ["@opencode-ai/llm/providers/amazon-bedrock", () => import("@opencode-ai/llm/providers/amazon-bedrock")],
  ["@opencode-ai/llm/providers/anthropic", () => import("@opencode-ai/llm/providers/anthropic")],
  ["@opencode-ai/llm/providers/azure", () => import("@opencode-ai/llm/providers/azure")],
  ["@opencode-ai/llm/providers/azure/chat", () => import("@opencode-ai/llm/providers/azure/chat")],
  ["@opencode-ai/llm/providers/azure/responses", () => import("@opencode-ai/llm/providers/azure/responses")],
  ["@opencode-ai/llm/providers/google", () => import("@opencode-ai/llm/providers/google")],
  ["@opencode-ai/llm/providers/openai", () => import("@opencode-ai/llm/providers/openai")],
  ["@opencode-ai/llm/providers/openai/chat", () => import("@opencode-ai/llm/providers/openai/chat")],
  ["@opencode-ai/llm/providers/openai/responses", () => import("@opencode-ai/llm/providers/openai/responses")],
  ["@opencode-ai/llm/providers/openai-compatible", () => import("@opencode-ai/llm/providers/openai-compatible")],
  ["@opencode-ai/llm/providers/openrouter", () => import("@opencode-ai/llm/providers/openrouter")],
  ["@opencode-ai/llm/providers/xai", () => import("@opencode-ai/llm/providers/xai")],
])

export const loadPackage = Effect.fn("ProviderV2.loadPackage")(function* (specifier: string, npm?: Npm.Interface) {
  const builtin = builtins.get(specifier)
  if (builtin) return yield* importPackage(specifier, specifier, builtin)
  const resolved = yield* Effect.sync(() => {
    if (specifier.startsWith("file://") || specifier.startsWith("@opencode-ai/ai/")) return specifier
    try {
      return import.meta.resolve(specifier)
    } catch {
      return undefined
    }
  })
  if (resolved) return yield* importPackage(specifier, resolved)
  if (!npm) {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} is not installed`),
    })
  }
  const parts = specifier.split("/")
  const root = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier)
  const installed = yield* npm.add(root).pipe(Effect.mapError((cause) => new LoadError({ package: specifier, cause })))
  const entrypoint = yield* Effect.try({
    try: () =>
      specifier === root && installed.entrypoint ? installed.entrypoint : resolveModule(specifier, installed.directory),
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  return yield* importPackage(specifier, entrypoint)
})

export function mergeOverlay(
  base: Readonly<Record<string, unknown>> | undefined,
  overlay: Readonly<Record<string, unknown>> | undefined,
): Record<string, Json> | undefined {
  if (base === undefined) return overlay && decodeJsonRecord({ ...overlay })
  if (overlay === undefined) return decodeJsonRecord({ ...base })
  return decodeJsonRecord(
    Object.fromEntries(
      new Set([...Object.keys(base), ...Object.keys(overlay)]).values().map((key): [string, unknown] => {
        const left = base[key]
        const right = overlay[key]
        if (right === undefined) return [key, left]
        if (
          typeof left === "object" &&
          left !== null &&
          !Array.isArray(left) &&
          typeof right === "object" &&
          right !== null &&
          !Array.isArray(right)
        )
          return [
            key,
            mergeOverlay(left as Readonly<Record<string, unknown>>, right as Readonly<Record<string, unknown>>) ?? {},
          ]
        return [key, right]
      }),
    ),
  )
}

export function mergeHeaders(
  base: Readonly<Record<string, string>> | undefined,
  overlay: Readonly<Record<string, string>> | undefined,
) {
  if (base === undefined) return overlay && { ...overlay }
  if (overlay === undefined) return { ...base }
  return Object.fromEntries(
    [...Object.entries(base), ...Object.entries(overlay)]
      .reduce((result, entry) => {
        result.set(entry[0].toLowerCase(), entry)
        return result
      }, new Map<string, [string, string]>())
      .values(),
  )
}

export const Request = Provider.Request
export type Request = Provider.Request

export const Settings = Provider.Settings
export type Settings = Provider.Settings

export const Info = Provider.Info
export type Info = Provider.Info

export type MutableInfo = DeepMutable<Info>

const importPackage = Effect.fn("ProviderV2.importPackage")(function* (
  specifier: string,
  entrypoint: string,
  load = () => importModule(entrypoint),
) {
  const module = yield* Effect.tryPromise({
    try: () => {
      const existing = packages.get(entrypoint)
      if (existing) return existing
      const loaded = load()
      packages.set(entrypoint, loaded)
      return loaded
    },
    catch: (cause) => new LoadError({ package: specifier, cause }),
  })
  if (typeof module !== "object" || module === null || typeof (module as { model?: unknown }).model !== "function") {
    return yield* new LoadError({
      package: specifier,
      cause: new Error(`Provider package ${specifier} does not export model(modelID, settings)`),
    })
  }
  return module as ProviderPackageDefinition
})
