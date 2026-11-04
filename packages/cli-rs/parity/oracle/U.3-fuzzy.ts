// P-ORACLE for crates/ui/src/select.rs `fuzzy`: runs fuzzysort.go exactly as DialogSelect calls it
// (packages/tui/src/ui/dialog-select.tsx:214-229) over a corpus built from the 244 keybind definitions, for a list of
// queries and both thresholds the TUI uses. Writes parity/fixtures/U.3/fuzzy.json; crates/ui/tests/dialogs.rs
// expects the same order.
import fuzzysort from "../../../tui/node_modules/fuzzysort"
import { Definitions } from "../../../tui/src/config/keybind"

const options = Object.entries(Definitions).map(([name, definition]) => ({
  title: definition.description,
  category: name.split(".")[0],
  searchText: name,
}))
const queries = [
  "s",
  "se",
  "session",
  "ses new",
  "new ses",
  "model",
  "mod fav",
  "toggle side",
  "sidebar",
  "x",
  "dialog sel",
  "pr",
  "ul",
  "SESS",
  "  tab  ",
  "input.",
  "cmd",
  "zzz",
  "copy last",
  "a b c",
  "exit app",
  "undo",
  "page down",
  "dg",
]

const cases = [0, 0.7].flatMap((threshold) =>
  queries.map((query) => ({
    query,
    threshold,
    results: fuzzysort
      .go(query.toLowerCase(), options, {
        keys: ["title", "category", "searchText"],
        scoreFn: (r) => r[0].score * 2 + r[1].score + r[2].score,
        threshold,
      })
      .map((x) => options.indexOf(x.obj)),
  })),
)

const path = new URL("../fixtures/U.3/fuzzy.json", import.meta.url).pathname
await Bun.write(path, JSON.stringify({ options, cases }, null, 1) + "\n")
console.log(`oracle: U.3/fuzzy ${cases.length} cases`)
