import { describe, test, expect, beforeAll } from "bun:test"
import { Parser, Language } from "web-tree-sitter"
import path from "path"

// Mirror the production DEFAULT_TIMEOUT from bash.ts (2 minutes)
const DEFAULT_TIMEOUT = 2 * 60 * 1000

describe("Ralph Loop Timeout Prevention", () => {
  let parser: Parser

  beforeAll(async () => {
    // Provide locateFile so Parser.init() finds tree-sitter.wasm on all platforms
    // (mirrors the production bash.ts initialization pattern)
    const treeWasm = path.resolve(import.meta.dirname, "../../node_modules/web-tree-sitter/tree-sitter.wasm")
    await Parser.init({ locateFile: () => treeWasm })
    const wasmPath = path.resolve(import.meta.dirname, "../../node_modules/tree-sitter-bash/tree-sitter-bash.wasm")
    const bashLanguage = await Language.load(wasmPath)
    parser = new Parser()
    parser.setLanguage(bashLanguage)
  })

  function analyzeTimeout(command: string) {
    const tree = parser.parse(command)
    expect(tree).not.toBeNull()

    const isOc = (text: string) => /^(oc|\.\/oc)$/.test(text)
    const usesOc = tree!.rootNode.descendantsOfType("command").some((n) => {
      if (!n) return false
      const name = n.childForFieldName("name") ?? n.firstChild
      return name !== null && isOc(name.text)
    })
    const timeout = usesOc ? 0 : DEFAULT_TIMEOUT

    return { usesOc, timeout }
  }

  test("bash tool should detect ANY oc command and set infinite timeout", () => {
    const ralphLoop = `while oc check "find and fix issues"; do
      oc status "round complete"
    done`

    const { usesOc, timeout } = analyzeTimeout(ralphLoop)

    expect(usesOc).toBe(true)
    expect(timeout).toBe(0) // infinite timeout - ANY oc command
  })

  test("regular bash commands should have normal timeout", () => {
    const regularCommand = "echo 'hello' && ls -la"
    const { usesOc, timeout } = analyzeTimeout(regularCommand)

    expect(usesOc).toBe(false)
    expect(timeout).toBe(DEFAULT_TIMEOUT) // normal 2 minute timeout
  })

  test("oc without while should also have infinite timeout", () => {
    const ocWithoutLoop = "oc check 'single check' && echo done"
    const { usesOc, timeout } = analyzeTimeout(ocWithoutLoop)

    expect(usesOc).toBe(true)
    expect(timeout).toBe(0) // infinite timeout - ANY oc can be long-running
  })

  test("while without oc should have normal timeout", () => {
    const whileWithoutOc = `while true; do
      echo "running..."
      sleep 1
    done`
    const { usesOc, timeout } = analyzeTimeout(whileWithoutOc)

    expect(usesOc).toBe(false)
    expect(timeout).toBe(DEFAULT_TIMEOUT) // normal timeout because no oc
  })

  test("complex Ralph loop should be detected", () => {
    const complexRalph = `
    echo "Starting quality analysis..."
    while oc check "DO THE ENTIRE CODE QUALITY ANALYSIS: find bugs, fix them, commit"; do
      oc status "Issues found and fixed, checking again..."
      git log --oneline -1
    done
    echo "Analysis complete!"`
    const { usesOc, timeout } = analyzeTimeout(complexRalph)

    expect(usesOc).toBe(true)
    expect(timeout).toBe(0) // infinite timeout for ANY oc command
  })

  test("./oc variant should also be detected", () => {
    const dotSlashOc = `while ./oc check "test"; do
      echo "loop"
    done`
    const { usesOc, timeout } = analyzeTimeout(dotSlashOc)

    expect(usesOc).toBe(true)
    expect(timeout).toBe(0) // infinite timeout for ANY oc command
  })
})
