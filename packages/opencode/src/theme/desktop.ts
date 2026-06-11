import { Glob } from "@opencode-ai/core/util/glob"
import { Global } from "@opencode-ai/core/global"
import { Option, Schema } from "effect"
import path from "node:path"

const HexColor = Schema.String.check(
  Schema.isPattern(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/),
)
const CssVar = Schema.String.check(Schema.isPattern(/^var\(--[a-z0-9-]+\)$/))
const ThemeID = Schema.String.check(Schema.isPattern(/^[a-z0-9-]+$/))
const ColorValue = Schema.Union([HexColor, CssVar])
const VariantBase = {
  overrides: Schema.optional(Schema.Record(Schema.String, ColorValue)),
  v2Overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}
const Palette = Schema.Struct({
  neutral: HexColor,
  ink: HexColor,
  primary: HexColor,
  success: HexColor,
  warning: HexColor,
  error: HexColor,
  info: HexColor,
  accent: Schema.optional(HexColor),
  interactive: Schema.optional(HexColor),
  diffAdd: Schema.optional(HexColor),
  diffDelete: Schema.optional(HexColor),
})
const Seeds = Schema.Struct({
  neutral: HexColor,
  primary: HexColor,
  success: HexColor,
  warning: HexColor,
  error: HexColor,
  info: HexColor,
  interactive: HexColor,
  diffAdd: HexColor,
  diffDelete: HexColor,
})
const ThemeVariant = Schema.Union([
  Schema.Struct({ palette: Palette, ...VariantBase }),
  Schema.Struct({ seeds: Seeds, ...VariantBase }),
])
const DesktopTheme = Schema.Struct({
  $schema: Schema.optional(Schema.String),
  name: Schema.String,
  id: ThemeID,
  light: ThemeVariant,
  dark: ThemeVariant,
})
const decodeTheme = Schema.decodeUnknownOption(DesktopTheme)

export function desktopThemeDirectories(cwd = process.cwd()) {
  const directories = [Global.Path.config]
  for (let current = cwd; ; current = path.dirname(current)) {
    directories.push(path.join(current, ".opencode"))
    if (path.dirname(current) === current) break
  }
  return directories
}

export async function discoverDesktopThemes(directories: string[]) {
  const result: Record<string, typeof DesktopTheme.Type> = {}
  for (const directory of directories) {
    const files = await Glob.scan("desktop-themes/*.json", { cwd: directory, absolute: true, dot: true, symlink: true }).catch(
      () => [],
    )
    for (const file of files) {
      const theme = Option.getOrUndefined(
        decodeTheme(
          await Bun.file(file)
            .json()
            .catch(() => undefined),
        ),
      )
      if (theme) result[theme.id] = theme
    }
  }
  return Object.values(result)
}
