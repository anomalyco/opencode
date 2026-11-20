import { describe, expect, test } from "bun:test"
import { OpencodeMemoryRecipe } from "@opencode/core/plugin/provider/opencode-memory-recipe"

describe("opencode memory recipe", () => {
  test("a chained test run that passes after another failed is the recipe, reduced to its steps", () => {
    const state = OpencodeMemoryRecipe.make()
    const runs = [
      {
        command: 'cd /work && python3 -m unittest discover -s tests/unit 2>&1; echo "exit=$?"',
        output: "Ran 2 tests in 0.000s\n\nFAILED (errors=2)\nexit=1",
        failed: false,
      },
      { command: "git status --short", output: "", failed: false },
      {
        command:
          'python3 tools/bootstrap.py && PYTHONPATH=src python3 -m unittest discover -s tests/unit 2>&1 | tail -5; echo "exit=$?"',
        output: "Ran 5 tests in 0.001s\n\nOK\nexit=0",
        failed: false,
      },
      { command: "make test", output: "Ran 5 tests\n\nOK", failed: false },
    ]
    const found = runs.map((run) => OpencodeMemoryRecipe.observe(state, run))
    expect(found).toEqual([
      undefined,
      undefined,
      {
        recipe: "python3 tools/bootstrap.py && PYTHONPATH=src python3 -m unittest discover -s tests/unit",
        before: "python3 -m unittest discover -s tests/unit",
      },
      undefined,
    ])
    const entry = { ...OpencodeMemoryRecipe.entry(found[2]!, "github.com/acme/rates"), via: "repository" }
    expect(entry.title).toBe(
      "To test github.com/acme/rates, run `python3 tools/bootstrap.py && PYTHONPATH=src python3 -m unittest discover -s tests/unit`",
    )
    expect(OpencodeMemoryRecipe.isRecipe(entry)).toBe(true)
    // Only repository procedures that carry a command are recipes.
    expect(OpencodeMemoryRecipe.isRecipe({ ...entry, kind: "convention" })).toBe(false)
    expect(OpencodeMemoryRecipe.isRecipe({ ...entry, via: "ranking" })).toBe(false)
    expect(
      OpencodeMemoryRecipe.isRecipe({
        kind: "procedure",
        via: "repository",
        title: "Tests need a recorded run",
        body: "Ask in #qa.",
      }),
    ).toBe(false)
  })
})
