import type { Config } from "../../src/config"

export type Draft = Parameters<Parameters<Config.Interface["update"]>[0]>[0]

export function cloneConfig(info: Config.Info): Draft {
  // SAFETY: structuredClone returns an independent value with the same runtime shape; Config.Info's readonly modifiers are type-only.
  return structuredClone(info) as Draft
}
