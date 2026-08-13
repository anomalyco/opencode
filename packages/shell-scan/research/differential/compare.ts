import { ShellScan } from "../../src/index.js"

type Shell = "bash" | "powershell"
type Commands = Array<{ resource: string; words: string[] }>
type Corpus = Record<Shell, Array<{ id: string; category: string; input: string }>>
type Baseline = Record<
  Shell,
  Array<{ id: string; result: { kind: "scanned"; commands: Commands } | { kind: "opaque"; reason: string } }>
>

const corpus = (await Bun.file(new URL("corpus.json", import.meta.url)).json()) as Corpus
const retained = (await Bun.file(new URL("tree-sitter.json", import.meta.url)).json()) as Baseline
const shells = (Object.keys(corpus) as Shell[]).map((shell) => {
  const expected = new Map(retained[shell].map((item) => [item.id, item.result]))
  const cases = corpus[shell].map((item) => {
    const current = shell === "bash" ? ShellScan.scan(item.input) : ShellScan.scanPowerShell(item.input)
    const former = expected.get(item.id)
    if (!former) throw new Error(`Missing retained ${shell} fixture: ${item.id}`)
    const exact = JSON.stringify(current) === JSON.stringify(former)
    return {
      id: item.id,
      category: item.category,
      former: former.kind,
      current: current.kind,
      difference: exact ? "none" : current.kind !== former.kind ? "kind" : "commands",
      ...(exact ? {} : { expected: former, actual: current }),
    }
  })
  return {
    shell,
    metrics: {
      corpus: cases.length,
      former_scanned: cases.filter((item) => item.former === "scanned").length,
      former_opaque: cases.filter((item) => item.former === "opaque").length,
      current_scanned: cases.filter((item) => item.current === "scanned").length,
      current_opaque: cases.filter((item) => item.current === "opaque").length,
      exact_parity: cases.filter((item) => item.difference === "none").length,
      kind_differences: cases.filter((item) => item.difference === "kind").length,
      command_differences: cases.filter((item) => item.difference === "commands").length,
    },
    differences: cases.filter((item) => item.difference !== "none"),
  }
})

console.log(
  JSON.stringify(
    {
      schema: 1,
      baseline: "tree-sitter Bash 0.25.0 / PowerShell 0.25.10 via web-tree-sitter 0.25.10",
      shells,
      metrics: {
        corpus: shells.reduce((total, item) => total + item.metrics.corpus, 0),
        current_scanned: shells.reduce((total, item) => total + item.metrics.current_scanned, 0),
        current_opaque: shells.reduce((total, item) => total + item.metrics.current_opaque, 0),
        exact_parity: shells.reduce((total, item) => total + item.metrics.exact_parity, 0),
        parity_differences: shells.reduce(
          (total, item) => total + item.metrics.kind_differences + item.metrics.command_differences,
          0,
        ),
      },
    },
    null,
    2,
  ),
)
