// Writes crates/ui/src/theme/generated/themes.json: every built-in theme as the V2 document the TypeScript TUI
// resolves under the `new-designs` experiment, so the Rust resolver starts from the same documents. V1 themes are
// migrated here, once per migration: `mini` is the `migrateV1` document, as mini parses without the experiment.
import { DEFAULT_THEMES, getOpenCodeClassicTheme, getOpenCodeTheme, parseTheme } from "../../../tui/src/theme/index.ts"

const output = new URL("../../crates/ui/src/theme/generated/themes.json", import.meta.url).pathname

// The order of the theme context's list (`allThemes`): the V1 defaults, opencode, then opencode-classic.
const themes = [
  ...Object.entries(DEFAULT_THEMES).map(([name, source]) => ({
    name,
    document: parseTheme(source, name, { newDesigns: true }),
    mini: parseTheme(source, name),
  })),
  { name: "opencode", document: getOpenCodeTheme() },
  { name: "opencode-classic", document: getOpenCodeClassicTheme() },
]

// One theme per line keeps the committed file small and its diffs readable.
const lines = themes.map((theme) => JSON.stringify(theme)).join(",\n")
await Bun.write(output, `{"themes":[\n${lines}\n]}\n`)
console.log(`themes: wrote ${themes.length} themes to ${output}`)
