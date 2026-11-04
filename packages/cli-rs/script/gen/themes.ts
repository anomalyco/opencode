// Writes crates/ui/src/theme/generated/themes.json: every built-in theme as the V2 document the TypeScript TUI
// resolves under the `new-designs` experiment, so the Rust resolver starts from the same documents. V1 themes are
// migrated here, once.
import { DEFAULT_THEMES, getOpenCode2Theme, getOpenCodeTheme, parseTheme } from "../../../tui/src/theme/index.ts"

const output = new URL("../../crates/ui/src/theme/generated/themes.json", import.meta.url).pathname

// The order of the theme context's list under new designs: opencode2, the V1 defaults, then opencode.
const themes = [
  { name: "opencode2", document: getOpenCode2Theme() },
  ...Object.entries(DEFAULT_THEMES).map(([name, source]) => ({
    name,
    document: parseTheme(source, name, { newDesigns: true }),
  })),
  { name: "opencode", document: getOpenCodeTheme() },
]

// One theme per line keeps the committed file small and its diffs readable.
const lines = themes.map((theme) => JSON.stringify(theme)).join(",\n")
await Bun.write(output, `{"themes":[\n${lines}\n]}\n`)
console.log(`themes: wrote ${themes.length} themes to ${output}`)
