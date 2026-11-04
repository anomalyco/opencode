// Writes crates/ui/src/theme/generated/themes.json: every built-in theme as the V2 document the TypeScript TUI
// resolves, so the Rust resolver starts from the same documents. V1 themes are migrated here, once per migration.
import { DEFAULT_THEMES, getOpenCode2Theme, getOpenCodeTheme, parseTheme } from "../../../tui/src/theme/index.ts"

const output = new URL("../../crates/ui/src/theme/generated/themes.json", import.meta.url).pathname

// The order of allThemes(): the V1 defaults, then opencode.
const themes = [
  ...Object.entries(DEFAULT_THEMES).map(([name, source]) => ({
    name,
    current: parseTheme(source, name),
    newDesigns: parseTheme(source, name, { newDesigns: true }),
  })),
  { name: "opencode", current: getOpenCodeTheme() },
]

// One theme per line keeps the committed file small and its diffs readable.
const lines = themes.map((theme) => JSON.stringify(theme)).join(",\n")
await Bun.write(output, `{"themes":[\n${lines}\n],\n"opencode2":${JSON.stringify(getOpenCode2Theme())}}\n`)
console.log(`themes: wrote ${themes.length} themes to ${output}`)
