#!/usr/bin/env bun

import { mapV2Semantics, mergeV2Tokens } from "../src/theme/map-v2-semantics"
import { V2_PRIMITIVES_DEFAULT } from "../src/theme/v2-primitives-default"

const light = mergeV2Tokens(V2_PRIMITIVES_DEFAULT, mapV2Semantics(false), {})
const dark = mergeV2Tokens(V2_PRIMITIVES_DEFAULT, mapV2Semantics(true), {})

const fmt = (obj: Record<string, string>) =>
  Object.entries(obj)
    .map(([key, value]) => `  "${key}": ${JSON.stringify(value)},`)
    .join("\n")

const output = `import type { V2ColorValue } from "./types"

/** OC-2 v2 tokens: default primitives + semantics (100% override preset). */
export const OC2_V2_LIGHT_OVERRIDES: Record<string, V2ColorValue> = {
${fmt(light)}
}

export const OC2_V2_DARK_OVERRIDES: Record<string, V2ColorValue> = {
${fmt(dark)}
}
`

await Bun.write(import.meta.dir + "/../src/theme/oc-2-v2-overrides.ts", output.trim() + "\n")
console.log("Wrote oc-2-v2-overrides.ts", Object.keys(light).length, "tokens per mode")
