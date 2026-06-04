#!/usr/bin/env bun

import { mapV2Semantics, mergeV2Tokens } from "../src/theme/v2/mapping"
import { V2_PRIMITIVES_DEFAULT } from "../src/theme/v2/default-primitives"
import type { DesktopTheme } from "../src/theme/types"

const themePath = import.meta.dir + "/../src/theme/themes/oc-2.json"
const theme = (await Bun.file(themePath).json()) as DesktopTheme

const light = mergeV2Tokens(V2_PRIMITIVES_DEFAULT, mapV2Semantics(false), {})
const dark = mergeV2Tokens(V2_PRIMITIVES_DEFAULT, mapV2Semantics(true), {})

const next: DesktopTheme = {
  ...theme,
  light: { ...theme.light, v2Overrides: light },
  dark: { ...theme.dark, v2Overrides: dark },
}

await Bun.write(themePath, JSON.stringify(next, null, 2) + "\n")
console.log("Updated oc-2.json v2Overrides", Object.keys(light).length, "tokens per mode")
