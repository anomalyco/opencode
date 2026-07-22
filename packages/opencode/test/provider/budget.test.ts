import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { Budget } from "../../src/provider/budget"
import { testEffect } from "../lib/effect"

const it = testEffect(Budget.defaultLayer)

describe("Budget.Service", () => {
  describe("BudgetExhaustedError", () => {
    it.effect("is a tagged error with correct shape", () =>
      Effect.gen(function* () {
        const err = new Budget.BudgetExhaustedError({
          message: "Budget exhausted",
          userId: "user-1",
          required: 100,
          balance: 50,
        })
        expect(err._tag).toBe("BudgetExhaustedError")
        expect(err.message).toBe("Budget exhausted")
        expect(err.userId).toBe("user-1")
        expect(err.required).toBe(100)
        expect(err.balance).toBe(50)
      }),
    )

    it.effect("can be created with only message", () =>
      Effect.gen(function* () {
        const err = new Budget.BudgetExhaustedError({ message: "Out of budget" })
        expect(err._tag).toBe("BudgetExhaustedError")
        expect(err.message).toBe("Out of budget")
        expect(err.userId).toBeUndefined()
        expect(err.required).toBeUndefined()
        expect(err.balance).toBeUndefined()
      }),
    )
  })

  describe("defaultLayer (no-op)", () => {
    it.effect("resolveModel returns zero cost", () =>
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        const result = yield* budget.resolveModel("test-model")
        expect(result).toEqual({ costPerToken: 0 })
      }),
    )

    it.effect("check does not throw", () =>
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.check({ userId: "user-1", estimatedCost: 100 })
      }),
    )

    it.effect("deduct does not throw", () =>
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.deduct({ userId: "user-1", amount: 50, description: "test" })
      }),
    )

    it.effect("credit does not throw", () =>
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.credit({ userId: "user-1", amount: 100, description: "test credit" })
      }),
    )

    it.effect("check succeeds even with zero balance", () =>
      Effect.gen(function* () {
        const budget = yield* Budget.Service
        yield* budget.check({ userId: "any-user", estimatedCost: 999999 })
      }),
    )
  })
})
