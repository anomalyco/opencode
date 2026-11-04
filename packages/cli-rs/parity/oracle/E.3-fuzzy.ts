// P-ORACLE for the autocomplete's ranking (`rank` in crates/tui/src/prompt/autocomplete/mod.rs): runs fuzzysort.go
// exactly as the `options` memo calls it (packages/tui/src/component/prompt/autocomplete.tsx:569-590), with its keys,
// scoreFn, threshold, and limit, over a corpus of the 244 keybind definitions as `/` commands and `@` mentions.
// Descriptions repeat in the corpus, so ties are covered. Writes parity/fixtures/E.3/fuzzy.json; the Rust test
// expects the same order.
import fuzzysort from "../../../tui/node_modules/fuzzysort"
import { Definitions } from "../../../tui/src/config/keybind"
import { stripFileLineRange } from "../../../tui/src/prompt/parse"

type Option = { display: string; description?: string }
const names = Object.entries(Definitions)
const corpus = {
  command: names.map(([name, definition]): Option => ({ display: `/${name}`, description: definition.description })),
  reference: names.map(([name, definition]): Option => ({ display: `@${name}`, description: definition.description })),
}
const queries = ["s", "se", "ses", "session", "model", "mod fav", "prompt", "pr", "app", "x", "undo", "tab", "q", "zzz"]

function go(mode: "command" | "reference", search: string) {
  const options = corpus[mode]
  return fuzzysort
    .go(stripFileLineRange(search), options, {
      keys: [
        (obj) => stripFileLineRange(obj.display.trimEnd()),
        ...(mode === "command" ? ["description" as const] : []),
        () => "",
      ],
      threshold: mode === "reference" ? 0.5 : 0,
      limit: 10,
      scoreFn: (objResults) => {
        const displayResult = objResults[0]
        let score = objResults.score
        const prefix = mode === "reference" ? "@" : "/"
        if (displayResult && displayResult.target.startsWith(prefix + search)) score *= 2
        return score
      },
    })
    .map((result) => options.indexOf(result.obj))
}

const cases = (["command", "reference"] as const).flatMap((mode) =>
  queries.map((query) => ({ mode, query, results: go(mode, query) })),
)
const path = new URL("../fixtures/E.3/fuzzy.json", import.meta.url).pathname
await Bun.write(path, JSON.stringify({ corpus, cases }, null, 1) + "\n")
console.log(`oracle: E.3/fuzzy ${cases.length} cases`)
