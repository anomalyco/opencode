import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { CodeMode, Tool } from "../src/index.js"

// `new` is supported syntax; only the callee decides whether construction succeeds. A callee without
// construction support is a TypeError naming it, like JS, rather than an unsupported-syntax diagnostic
// that would suggest `new` itself is unavailable.
const tools = {
  echo: Tool.make({
    description: "Echo",
    input: Schema.Struct({}),
    output: Schema.Struct({}),
    execute: () => Effect.succeed({}),
  }),
}
const run = (code: string) => Effect.runPromise(CodeMode.execute({ code, tools }))
const value = async (code: string) => {
  const result = await run(code)
  if (!result.ok) throw new Error(`expected success, got ${result.error.kind}: ${result.error.message}`)
  return result.value
}
const error = async (code: string) => {
  const result = await run(code)
  if (result.ok) throw new Error(`expected failure, got value ${JSON.stringify(result.value)}`)
  return result.error
}

const supportedConstructors = async () => {
  const failure = await error(`return new Number(1)`)
  const match = failure.message.match(/Supported constructors: (.+)\. \(line/)
  if (match === null) throw new Error(`no constructor list in: ${failure.message}`)
  return match[1].split(", ")
}

describe("new on a non-constructible callee", () => {
  test("built-in functions without construction point at the plain call", async () => {
    // Number is a real constructor in JS, so the message must not claim otherwise.
    const failure = await error(`return new Number(42)`)
    expect(failure.kind).toBe("ExecutionFailure")
    expect(failure.message).toStartWith(
      "new Number(...) is not supported; call Number(...) without new instead. Supported constructors: Object, Array, ",
    )
    expect(failure.suggestions).toEqual([expect.stringContaining("Supported constructors: ")])
    expect((await error(`return new String("a")`)).message).toStartWith("new String(...) is not supported")
    expect((await error(`return new Math.abs(1)`)).message).toStartWith(
      "new Math.abs(...) is not supported; call Math.abs(...) without new instead.",
    )
  })

  test("non-callable values are not constructors", async () => {
    expect((await error(`return new tools.echo()`)).message).toStartWith("tools.echo is not a constructor.")
    expect((await error(`return new (1)()`)).message).toStartWith("The called value is not a constructor.")
    expect((await error(`const Date = 5; return new Date()`)).message).toStartWith("Date is not a constructor.")
  })

  test("user-defined functions explain the documented gap", async () => {
    const failure = await error(`function Point(x) { return { x } }; return new Point(1)`)
    expect(failure.message).toStartWith(
      "Point cannot be constructed: user-defined constructors and classes are not supported. Call it as a function that returns a plain object instead.",
    )
    expect((await error(`const make = () => ({}); return new make()`)).message).toStartWith(
      "make cannot be constructed",
    )
  })

  test("the failure is a catchable TypeError", async () => {
    expect(
      await value(`
        try { new Number(1) } catch (error) { return [error.name, error instanceof TypeError] }
      `),
    ).toEqual(["TypeError", true])
  })

  test("an undeclared callee still fails as an unknown identifier", async () => {
    expect((await error(`return new Function("return 1")`)).message).toContain("Function")
    expect((await error(`return new Function("return 1")`)).message).not.toContain("not a constructor")
  })

  test("classes remain unsupported syntax", async () => {
    const failure = await error(`class A {}; return new A()`)
    expect(failure.kind).toBe("UnsupportedSyntax")
    expect(failure.message).toStartWith("Syntax 'ClassDeclaration' is not supported.")
  })
})

describe("supported constructor list", () => {
  test("every listed constructor constructs", async () => {
    const constructors = await supportedConstructors()
    expect(constructors).toEqual([
      "Object",
      "Array",
      "Promise",
      "Date",
      "RegExp",
      "Map",
      "Set",
      "URL",
      "URLSearchParams",
      "Error",
      "TypeError",
      "RangeError",
      "SyntaxError",
      "ReferenceError",
      "EvalError",
      "URIError",
      "AggregateError",
    ])
    for (const name of constructors) {
      const argument =
        name === "Promise" ? "() => {}" : name === "AggregateError" ? "[]" : name === "URL" ? '"https://a.b/"' : ""
      expect(await value(`return typeof new ${name}(${argument})`)).toBe("object")
    }
  })
})
