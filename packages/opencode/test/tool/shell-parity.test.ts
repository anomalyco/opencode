import { beforeAll, describe, expect, test } from "bun:test"
import { fileURLToPath } from "url"
import { Language, Parser } from "web-tree-sitter"
import { commandParts } from "@opencode-ai/core/util/bash"

// Parity guard for the bash parser swap (tree-sitter-bash -> unbash).
// The tree-sitter extraction below is a frozen reference that mirrors the
// pre-swap bash `parts()` / `commands()` / `source()` in src/tool/shell.ts.
// tree-sitter-bash is retained as a devDependency solely to keep this guard live.

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  return fileURLToPath(new URL(asset, import.meta.url))
}

let bash: Parser
beforeAll(async () => {
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } })
  await Parser.init({ locateFile: () => resolveWasm(treeWasm) })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  bash = new Parser()
  bash.setLanguage(await Language.load(resolveWasm(bashWasm)))
})

type Norm = { tokens: string[]; source: string }

const TOKEN_TYPES = ["command_name", "command_name_expr", "word", "string", "raw_string", "concatenation"]
function treeParts(node: any): string[] {
  const out: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push(item.text)
      }
      continue
    }
    if (!TOKEN_TYPES.includes(child.type)) continue
    out.push(child.text)
  }
  return out
}
const treeSource = (node: any): string =>
  (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()

const tree = (command: string): Norm[] =>
  bash
    .parse(command)!
    .rootNode.descendantsOfType("command")
    .filter(Boolean)
    .map((node: any) => ({ tokens: treeParts(node), source: treeSource(node) }))

const unbash = (command: string): Norm[] =>
  commandParts(command).map((c) => ({ tokens: c.parts.map((p) => p.text), source: c.source }))

const CORPUS = [
  `echo hello`,
  `git commit -m "msg"`,
  `cat 'a b.txt'`,
  `rm -rf /tmp/x`,
  `cat a.txt > out.log 2>&1`,
  `ls -la | grep foo | wc -l`,
  `a && b || c ; d`,
  `echo $(date) > log`,
  `echo "hi $(rm -rf /tmp/z)"`,
  `diff <(sort a) <(sort b)`,
  `(cd /tmp && make)`,
  `if [ -f x ]; then rm x; fi`,
  `for f in *.txt; do cat "$f"; done`,
  `for ((i=0;i<1;i++)); do echo "$i"; done`,
  `case $x in a) ls;; esac`,
  `test -f foo && echo yes`,
  `[[ -d /tmp ]] && echo y`,
  `! grep foo bar`,
  `npm run build`,
  `echo \`whoami\``,
  `find . -name '*.ts' -exec rm {} \\;`,
  `git -C /path status`,
  `npm run build -- --flag`,
  `cmd 2>/dev/null`,
  `cmd <<< "here"`,
  `a |& b`,
  `echo {a,b}`,
  `cmd $((1+2))`,
  `\${VAR} arg`,
  `cmd "a\${B}c" plain`,
  `cmd 'single' "double" plain`,
  `kubectl get pods -n kube-system`,
  `docker compose up -d`,
  `git stash pop`,
  `rm -rf "$(pwd)/dist"`,
  `while read l; do echo $l; done < file`,
  `sudo apt-get install -y curl`,
  `tar -czf out.tar.gz /etc/foo`,
  `psql -c "select 1" && echo ok`,
]

describe("shell parser parity (unbash vs tree-sitter-bash)", () => {
  for (const command of CORPUS) {
    test(`matches tree-sitter for: ${command}`, () => {
      expect(unbash(command)).toEqual(tree(command))
    })
  }

  test("unbash unwraps the `time` keyword to the real command (improvement over tree-sitter)", () => {
    // tree-sitter treats `time` as the command name; unbash identifies `ls`,
    // so the approved command/pattern is the one that actually runs.
    expect(tree("time ls")).toEqual([{ tokens: ["time", "ls"], source: "time ls" }])
    expect(unbash("time ls")).toEqual([{ tokens: ["ls"], source: "ls" }])
  })

  test("unbash drops assignment prefixes from permission patterns", () => {
    expect(tree("FOO=bar rm -rf /tmp/x")).toEqual([
      { tokens: ["rm", "-rf", "/tmp/x"], source: "FOO=bar rm -rf /tmp/x" },
    ])
    expect(unbash("FOO=bar rm -rf /tmp/x")).toEqual([{ tokens: ["rm", "-rf", "/tmp/x"], source: "rm -rf /tmp/x" }])
  })

  test("parses tolerantly without throwing on malformed input", () => {
    for (const command of [`cat "unterminated`, `for do done |&`, `$(((`, `if then`, `) ) )`]) {
      expect(() => unbash(command)).not.toThrow()
    }
  })
})
