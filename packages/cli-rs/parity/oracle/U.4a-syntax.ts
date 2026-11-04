// P-ORACLE for U.4a: the syntax style the TUI derives from a theme (`generateSyntax`, packages/theme/src/tui/syntax.ts)
// for a few built-in themes and modes. Writes parity/fixtures/U.4a/syntax.json; crates/ui/tests/content.rs builds
// opencode_ui::code::syntax_theme for the same themes and compares every scope.
import { ResourceContext } from "@opentui/core"
import { generateSyntax, resolveThemeDocument } from "../../../theme/src/tui/index.ts"
import { allThemes, parseTheme } from "../../../tui/src/theme/index.ts"

const output = new URL("../fixtures/U.4a/syntax.json", import.meta.url).pathname
const views = [
  ["opencode", "dark"],
  ["opencode", "light"],
  ["tokyonight", "dark"],
  ["github", "light"],
] as const

type Color = { toInts(): [number, number, number, number] }
const pack = (color: Color | undefined) =>
  color
    ?.toInts()
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")

const owner = new ResourceContext({ objectCapacity: 1, renderCellsMax: 1 })
const result = views.map(([name, mode]) => {
  const syntax = generateSyntax(resolveThemeDocument(parseTheme(allThemes()[name], name, { newDesigns: true }), mode), owner)
  const styles = Object.fromEntries(
    [...syntax.getAllStyles()].map(([scope, style]) => [
      scope,
      [pack(style.fg), pack(style.bg), style.bold ?? false, style.italic ?? false, style.underline ?? false],
    ]),
  )
  syntax.destroy()
  return { name, mode, styles }
})
owner.destroy()

// One scope per line, so a diff of the fixture names the scopes that changed.
const lines = result.map(
  (view) =>
    `{"name":${JSON.stringify(view.name)},"mode":${JSON.stringify(view.mode)},"styles":{\n` +
    Object.entries(view.styles)
      .map(([scope, style]) => `  ${JSON.stringify(scope)}:${JSON.stringify(style)}`)
      .join(",\n") +
    "\n}}",
)
await Bun.write(output, `[\n${lines.join(",\n")}\n]\n`)
console.log(`oracle: U.4a/syntax ${result.length} views`)
