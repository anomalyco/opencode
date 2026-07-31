import { describe, expect, test } from "bun:test"
import {
  evaluateInventoryCases,
  type InventoryGoldCase,
  type InventoryGoldExpectedCase,
} from "../src/inventory-eval"
import fixture from "./fixtures/inventory-gold.json"

const cases: InventoryGoldExpectedCase[] = fixture.cases.map((item) => ({
  id: item.id,
  category: category(item.category),
  expected: {
    intent: {
      kind: item.expected.intent.kind,
      term: item.expected.intent.term,
    },
    templateVersion: item.expected.templateVersion,
    parameters: item.expected.parameters,
    result: item.expected.result,
    answer: item.expected.answer,
    policy: policy(item.expected.policy),
  },
}))

function perfectCases(): InventoryGoldCase[] {
  return cases.map((item) => ({
    ...item,
    observed: structuredClone(item.expected),
  }))
}

describe("evaluateInventoryCases", () => {
  test("passes 20 read cases and all policy cases at exact agreement", () => {
    const cases = perfectCases()

    expect(cases.filter((item) => item.category === "read")).toHaveLength(20)
    expect(evaluateInventoryCases(cases)).toEqual({
      intent: 1,
      sql: 1,
      result: 1,
      answer: 1,
      policy: 1,
      passed: true,
    })
  })

  test("accepts exactly 95 percent on a read layer", () => {
    const cases = perfectCases()
    const target = cases.find((item) => item.id === "read-20-minimal")
    if (!target) throw new Error("fixture mismatch")
    target.observed.answer = "错误回答"

    expect(evaluateInventoryCases(cases)).toMatchObject({
      answer: 0.95,
      passed: true,
    })
  })

  test("blocks release below 95 percent on any read layer", () => {
    const cases = perfectCases()
    cases
      .filter((item) => item.category === "read")
      .slice(0, 2)
      .forEach((item) => {
        item.observed.answer = "错误回答"
      })

    expect(evaluateInventoryCases(cases)).toMatchObject({
      answer: 0.9,
      passed: false,
    })
  })

  test("scores intent, SQL parameters, and mapped result independently", () => {
    const intentCases = perfectCases()
    const sqlCases = perfectCases()
    const resultCases = perfectCases()
    intentCases[0].observed.intent.term = "wrong"
    sqlCases[0].observed.parameters = { term: "wrong", limit: 20 }
    resultCases[0].observed.result = []

    expect(evaluateInventoryCases(intentCases)).toMatchObject({
      intent: 0.95,
      sql: 1,
      result: 1,
    })
    expect(evaluateInventoryCases(sqlCases)).toMatchObject({
      intent: 1,
      sql: 0.95,
      result: 1,
    })
    expect(evaluateInventoryCases(resultCases)).toMatchObject({
      intent: 1,
      sql: 1,
      result: 0.95,
    })
  })

  test("requires every policy case to pass", () => {
    const cases = perfectCases()
    const target = cases.find((item) => item.id === "policy-01-write-blocked")
    if (!target) throw new Error("fixture mismatch")
    target.observed.policy = "allow"

    const result = evaluateInventoryCases(cases)
    expect(result.policy).toBeLessThan(1)
    expect(result.passed).toBeFalse()
  })

  test("scores empty layers as zero", () => {
    expect(evaluateInventoryCases([])).toEqual({
      intent: 0,
      sql: 0,
      result: 0,
      answer: 0,
      policy: 0,
      passed: false,
    })
  })
})

function category(value: string) {
  if (value === "read" || value === "policy") return value
  throw new Error("fixture category mismatch")
}

function policy(value: string) {
  if (value === "allow" || value === "block") return value
  throw new Error("fixture policy mismatch")
}
