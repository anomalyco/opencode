import { describe, expect, test } from "bun:test"
import { Effect, Result, Schema } from "effect"
import { collectFailures, recover, repair } from "../../src/tool/repair"

const Question = Schema.Struct({
  questions: Schema.Array(
    Schema.Struct({
      question: Schema.String,
      options: Schema.Array(Schema.String),
    }),
  ),
})

const Read = Schema.Struct({
  filePath: Schema.String,
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
})

// decodeUnknownResult's failure value IS the parse issue (Composite/Pointer/leaf
// tree). decodeUnknownEffect wraps it in a SchemaError with a `.issue` field —
// recover() peels that off before calling repair(), so the tests pass the raw
// issue directly.
const issueFor = (schema: Schema.Decoder<unknown>, input: unknown) => {
  const result = Schema.decodeUnknownResult(schema)(input)
  if (Result.isSuccess(result)) throw new Error("expected decode failure")
  return result.failure
}

const decodes = (schema: Schema.Decoder<unknown>, input: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(input))

describe("repair.collectFailures", () => {
  test("flattens nested Composite/Pointer issues to (path, tag) leaves", () => {
    const failures = collectFailures(
      issueFor(Question, { questions: [{ question: "q", options: "wrong" }] }),
    )
    expect(failures).toEqual([{ path: ["questions", 0, "options"], tag: "InvalidType" }])
  })

  test("returns empty for a non-issue input", () => {
    expect(collectFailures(null)).toEqual([])
    expect(collectFailures(undefined)).toEqual([])
    expect(collectFailures({})).toEqual([])
  })
})

describe("repair: shape repairs", () => {
  test("null at optional field is dropped", () => {
    const input = { filePath: "/a", offset: null }
    const issue = issueFor(Read, input)
    const result = repair(input, issue)
    expect(result).not.toBeUndefined()
    expect(result!.value).toEqual({ filePath: "/a" })
    expect(decodes(Read, result!.value)).toBe(true)
  })

  test("stringified JSON array is parsed", () => {
    const input = { questions: [{ question: "q", options: '["a","b"]' }] }
    const issue = issueFor(Question, input)
    const result = repair(input, issue)
    expect(result).not.toBeUndefined()
    expect(result!.value).toEqual({ questions: [{ question: "q", options: ["a", "b"] }] })
    expect(decodes(Question, result!.value)).toBe(true)
  })

  test("empty-object placeholder at optional field is dropped", () => {
    const input = { filePath: "/a", offset: {} }
    const issue = issueFor(Read, input)
    const result = repair(input, issue)
    expect(result).not.toBeUndefined()
    expect(result!.value).toEqual({ filePath: "/a" })
    expect(decodes(Read, result!.value)).toBe(true)
  })

  test("bare string in array position is wrapped", () => {
    const input = { questions: [{ question: "q", options: "foo" }] }
    const issue = issueFor(Question, input)
    const result = repair(input, issue)
    expect(result).not.toBeUndefined()
    expect(result!.value).toEqual({ questions: [{ question: "q", options: ["foo"] }] })
    expect(decodes(Question, result!.value)).toBe(true)
  })

  test("ordering: stringified array beats bare-string-wrap (the load-bearing case)", () => {
    // '["a","b"]' is both a string and array-shaped JSON. If bare-string-wrap
    // ran first the result would become ['["a","b"]']. Parse must win here.
    const input = { questions: [{ question: "q", options: '["a","b"]' }] }
    const result = repair(input, issueFor(Question, input))
    expect((result!.value as any).questions[0].options).toEqual(["a", "b"])
  })

  test("returns undefined when no path is repairable (MissingKey)", () => {
    // Required-but-missing field — we don't know what to fill, so no repair.
    const input = { questions: [{ options: ["a"] }] }
    const result = repair(input, issueFor(Question, input))
    expect(result).toBeUndefined()
  })

  test("Effect Schema reports one failing path at a time; multi-path inputs converge via recover()", () => {
    // The validator short-circuits at the first failing element, so a single
    // `repair()` call only fixes one path. The full convergence loop is in
    // `recover()` (tested below).
    const input = {
      questions: [
        { question: "q1", options: "foo" },
        { question: "q2", options: '["a","b"]' },
      ],
    }
    const first = repair(input, issueFor(Question, input))
    expect(first).not.toBeUndefined()
    expect((first!.value as any).questions[0].options).toEqual(["foo"])
    // Second path is still broken until recover() loops on us.
    expect((first!.value as any).questions[1].options).toEqual('["a","b"]')
  })

  test("does not mutate the original input", () => {
    const input = { filePath: "/a", offset: null }
    const issue = issueFor(Read, input)
    repair(input, issue)
    expect(input).toEqual({ filePath: "/a", offset: null })
  })
})

describe("recover: decode → repair → re-decode loop", () => {
  const decodeWith = (schema: Schema.Decoder<unknown>) => Schema.decodeUnknownEffect(schema)

  const runRecover = async (schema: Schema.Decoder<unknown>, bad: unknown) => {
    const decode = decodeWith(schema)
    return Effect.runPromise(
      decode(bad).pipe(
        Effect.catch((err) => recover(decode, bad, err)),
        Effect.exit,
      ),
    )
  }

  test("single-path repair: bare scalar wrapped to array", async () => {
    const exit = await runRecover(Question, { questions: [{ question: "q", options: "foo" }] })
    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect((exit.value as any).questions[0].options).toEqual(["foo"])
  })

  test("multi-path: loop converges as the validator surfaces one path at a time", async () => {
    // First pass repairs questions[0].options; second pass repairs
    // questions[1].options; third pass succeeds.
    const exit = await runRecover(Question, {
      questions: [
        { question: "q1", options: "foo" },
        { question: "q2", options: '["a","b"]' },
      ],
    })
    expect(exit._tag).toBe("Success")
    if (exit._tag !== "Success") return
    expect((exit.value as any).questions[0].options).toEqual(["foo"])
    expect((exit.value as any).questions[1].options).toEqual(["a", "b"])
  })

  test("unrepairable failure surfaces the original error untouched", async () => {
    // Missing required key — no repair applies.
    const exit = await runRecover(Question, { questions: [{ options: ["a"] }] })
    expect(exit._tag).toBe("Failure")
  })
})
