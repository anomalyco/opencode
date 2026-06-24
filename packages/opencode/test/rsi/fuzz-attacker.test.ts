import { describe, expect, test } from "bun:test"
import { FuzzAttacker } from "../../src/muel/fuzz-attacker"
import type { Transaction } from "../../src/muel/fuzz-attacker"

const attacker = new FuzzAttacker()

function returnLength(txs: Transaction[]) {
  return txs.length
}

function returnSum(txs: Transaction[]) {
  return txs.reduce((s, t) => s + t.amount, 0)
}

function throwOnZeroAmount(txs: Transaction[]) {
  for (const tx of txs) {
    if (tx.amount === 0) throw new Error("zero amount detected")
  }
  return txs
}

function filterPositive(txs: Transaction[]) {
  return txs.filter(t => t.amount > 0)
}

function detectNegatives(txs: Transaction[]) {
  const result: Array<{ id: string; amount: number }> = []
  for (const tx of txs) {
    if (tx.amount < 0) result.push({ id: tx.id, amount: tx.amount })
  }
  return result
}

function detectDuplicates(txs: Transaction[]) {
  const seen = new Set<string>()
  const result: string[] = []
  for (const tx of txs) {
    if (seen.has(tx.id)) result.push(tx.id)
    seen.add(tx.id)
  }
  return result
}

describe("FuzzAttacker", () => {
  test("generateInputs(0) mengembalikan array kosong", () => {
    const inputs = attacker.generateInputs(0)
    expect(inputs).toEqual([])
  })

  test("generateInputs(1) mengembalikan array dengan 1 Transaction[] valid", () => {
    const inputs = attacker.generateInputs(1)
    expect(inputs.length).toBe(1)
    const txs = inputs[0]
    expect(txs.length).toBeGreaterThanOrEqual(1)
    expect(typeof txs[0].id).toBe("string")
    expect(typeof txs[0].amount).toBe("number")
    expect(typeof txs[0].date).toBe("string")
  })

  test("generateInputs(5) mengembalikan array length 5 dengan variasi", () => {
    const inputs = attacker.generateInputs(5)
    expect(inputs.length).toBe(5)
    const hasNegative = inputs.some(txs => txs.some(t => t.amount < 0))
    expect(hasNegative).toBe(true)
  })

  test("fuzzTest dengan empty input tidak crash", () => {
    const result = attacker.fuzzTest(returnLength, [])
    expect(result.total).toBe(0)
    expect(result.passed).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.errors).toEqual([])
  })

  test("fuzzTest dengan valid input semua passed", () => {
    const inputs = attacker.generateInputs(3)
    const result = attacker.fuzzTest(returnLength, inputs)
    expect(result.total).toBe(inputs.length)
    expect(result.passed).toBe(inputs.length)
    expect(result.failed).toBe(0)
  })

  test("fuzzTest dengan input campuran (ada yang crash) tetap graceful", () => {
    const inputs = attacker.generateInputs(5)
    const result = attacker.fuzzTest(throwOnZeroAmount, inputs)
    expect(result.total).toBe(inputs.length)
    expect(result.passed + result.failed).toBe(inputs.length)
    expect(result.errors.length).toBe(result.failed)
  })

  test("fuzzTest dengan input kotor tidak crash total", () => {
    const malformed = [[null as unknown as Transaction]]
    const result = attacker.fuzzTest(detectNegatives, malformed)
    expect(result.total).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.errors.length).toBe(1)
  })

  test("behavioralDiff dengan dua fungsi identik menghasilkan diff kosong", () => {
    const inputs = attacker.generateInputs(3)
    const diff = attacker.behavioralDiff(detectNegatives, detectNegatives, inputs)
    expect(diff.length).toBe(0)
  })

  test("behavioralDiff dengan dua fungsi berbeda menghasilkan diff", () => {
    const inputs = attacker.generateInputs(5)
    const diff = attacker.behavioralDiff(returnLength, returnSum, inputs)
    expect(diff.length).toBeGreaterThan(0)
    for (const entry of diff) {
      expect(typeof entry.inputIndex).toBe("number")
    }
  })

  test("behavioralDiff menangkap crash pada satu fungsi", () => {
    const txs: Transaction[] = [{ id: "x", amount: 0, date: "2024-01-01" }]
    const diff = attacker.behavioralDiff(returnLength, throwOnZeroAmount, [txs])
    expect(diff.length).toBe(1)
    expect(diff[0].crashA).toBe(false)
    expect(diff[0].crashB).toBe(true)
  })
})

describe("FuzzAttacker Domain Functions", () => {
  test("detectNegatives menemukan amount < 0", () => {
    const txs: Transaction[] = [
      { id: "a", amount: -50, date: "2024-01-01" },
      { id: "b", amount: 100, date: "2024-01-02" },
    ]
    const result = detectNegatives(txs)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe("a")
  })

  test("detectDuplicates menemukan ID duplikat", () => {
    const txs: Transaction[] = [
      { id: "a", amount: 10, date: "2024-01-01" },
      { id: "a", amount: 20, date: "2024-01-02" },
    ]
    const result = detectDuplicates(txs)
    expect(result).toEqual(["a"])
  })

  test("filterPositive mengembalikan hanya amount > 0", () => {
    const txs: Transaction[] = [
      { id: "a", amount: -10, date: "2024-01-01" },
      { id: "b", amount: 50, date: "2024-01-02" },
    ]
    const result = filterPositive(txs)
    expect(result.length).toBe(1)
    expect(result[0].id).toBe("b")
  })
})
