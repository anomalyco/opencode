import { describe, expect, test } from "bun:test"
import path from "path"
import { Bash } from "@opencode-ai/core/util/bash"

/**
 * The shell tool only acts on absolute words, and collects them into a set, so assert against
 * the same slice it sees without depending on traversal order or repeats.
 */
function absolute(command: string) {
  return [...new Set(Bash.pathWords(command).filter((value) => path.isAbsolute(value)))].sort()
}

describe("util.bash", () => {
  test("reads arguments, command names, and separators", () => {
    expect(absolute("cat /outside/x")).toEqual(["/outside/x"])
    expect(absolute("cat /outside/x;")).toEqual(["/outside/x"])
    expect(absolute("/outside/bin/tool")).toEqual(["/outside/bin/tool"])
    expect(absolute("cat /outside/a && cat /outside/b")).toEqual(["/outside/a", "/outside/b"])
  })

  test("dequotes and unescapes paths containing spaces", () => {
    expect(absolute("cat /outside/my\\ dir/file")).toEqual(["/outside/my dir/file"])
    expect(absolute(`cat /outside/"my dir"/file`)).toEqual(["/outside/my dir/file"])
    expect(absolute(`cat '/outside/my dir/file'`)).toEqual(["/outside/my dir/file"])
  })

  test("ignores comments", () => {
    expect(absolute("echo ok # /outside/secret/x")).toEqual([])
  })

  test("leaves unexpanded parameters relative but keeps literal prefixes", () => {
    expect(absolute("cat $HOME/x")).toEqual([])
    expect(absolute("cat ${HOME}/x")).toEqual([])
    expect(absolute("cat /outside/$VAR")).toEqual(["/outside/$VAR"])
  })

  test("reads redirect targets, including without a space", () => {
    expect(absolute("echo hi > /outside/out.txt")).toEqual(["/outside/out.txt"])
    expect(absolute("echo hi >/outside/out.txt")).toEqual(["/outside/out.txt"])
    expect(absolute("cat < /outside/in.txt")).toEqual(["/outside/in.txt"])
    expect(absolute("{ echo hi; } > /outside/brace/out")).toEqual(["/outside/brace/out"])
  })

  test("separates the file and descriptor forms of >&", () => {
    expect(absolute("echo hi &> /outside/out.txt")).toEqual(["/outside/out.txt"])
    expect(absolute("echo hi >& /outside/out.txt")).toEqual(["/outside/out.txt"])
    expect(absolute("echo hi 2>&1")).toEqual([])
    expect(absolute("echo hi >&-")).toEqual([])
  })

  test("reads assignment values and their substitutions", () => {
    expect(absolute("RESULT=$(cat /outside/secret/x)")).toEqual(["/outside/secret/x"])
    expect(absolute("FOO=/outside/assign/x cat y")).toEqual(["/outside/assign/x"])
  })

  test("reads parameter expansion defaults", () => {
    expect(absolute(`cat "${"${FILE:-/outside/default/x}"}"`)).toEqual(["/outside/default/x"])
    expect(absolute("cat ${FILE:=/outside/default/x}")).toEqual(["/outside/default/x"])
  })

  test("reads array assignment elements", () => {
    expect(absolute("FILES=( /outside/a /outside/b )")).toEqual(["/outside/a", "/outside/b"])
  })

  test("descends into substitutions nested in expansions and arithmetic", () => {
    expect(absolute("cat ${value:$(cat /outside/slice/x)}")).toEqual(["/outside/slice/x"])
    expect(absolute("cat ${value//a/$(cat /outside/repl/x)}")).toEqual(["/outside/repl/x"])
    expect(absolute("echo $(( $(cat /outside/arith/x) ))")).toEqual(["/outside/arith/x"])
    expect(absolute("(( $(cat /outside/arith/x) ))")).toEqual(["/outside/arith/x"])
    expect(absolute("for (( i=$(cat /outside/init/x); i<2; i++ )); do echo hi; done")).toEqual(["/outside/init/x"])
  })

  test("treats heredoc delimiters and bodies as data, not paths", () => {
    expect(absolute("cat <<EOF\n/outside/heredoc/x\nEOF")).toEqual([])
    expect(absolute("cat <<EOF\n$(ls /outside/nested)\nEOF")).toEqual(["/outside/nested"])
  })

  test("descends into substitutions", () => {
    expect(absolute("cat $(ls /outside/nested)")).toEqual(["/outside/nested"])
    expect(absolute("diff <(cat /outside/a) <(cat /outside/b)")).toEqual(["/outside/a", "/outside/b"])
  })

  // A quoted `sh -c` payload stays one opaque word; reading inside it means knowing which
  // programs re-interpret an argument as a script, which is a separate question from parsing.
  test("reads a shell invocation as plain words", () => {
    expect(absolute(`sh -c "cat /outside/secret/x"`)).toEqual([])
    expect(absolute(`/bin/bash -lc "cat /outside/secret/x"`)).toEqual(["/bin/bash"])
  })

  test("reads compound and test constructs", () => {
    expect(absolute("for f in /outside/a /outside/b; do cat $f; done")).toEqual(["/outside/a", "/outside/b"])
    expect(absolute("[ -f /outside/test/x ]")).toEqual(["/outside/test/x"])
    expect(absolute("[[ -f /outside/test/x ]]")).toEqual(["/outside/test/x"])
    expect(absolute("case /outside/x in /outside/*) cat /outside/y;; esac")).toEqual([
      "/outside/*",
      "/outside/x",
      "/outside/y",
    ])
    expect(absolute("while cat /outside/w; do cat /outside/body; done")).toEqual(["/outside/body", "/outside/w"])
    expect(absolute("if cat /outside/if; then cat /outside/then; else cat /outside/else; fi")).toEqual([
      "/outside/else",
      "/outside/if",
      "/outside/then",
    ])
    expect(absolute("f() { cat /outside/fn; }")).toEqual(["/outside/fn"])
    expect(absolute("cat /outside/a | grep /outside/b")).toEqual(["/outside/a", "/outside/b"])
  })
})
