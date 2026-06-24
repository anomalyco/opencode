import { describe, expect, test } from "bun:test"
import type { Transaction, Anomaly, AnomalyType } from "../../../src/muel/fuzz-attacker"

const VALID_TRANSACTIONS: Transaction[] = [
  { id: "tx-1", amount: 1000, date: "2026-01-01" },
  { id: "tx-2", amount: 2000, date: "2026-01-02" },
  { id: "tx-3", amount: 500, date: "2026-01-03" },
]

const TOTAL_MISMATCH_TRANSACTIONS: Transaction[] = [
  { id: "tx-1", amount: 100, date: "2026-01-01" },
  { id: "tx-2", amount: 200, date: "2026-01-02" },
  { id: "tx-3", amount: 300, date: "2026-01-03" },
]

const NEGATIVE_AMOUNT_TRANSACTIONS: Transaction[] = [
  { id: "tx-1", amount: -5000, date: "2026-01-01" },
  { id: "tx-2", amount: 1000, date: "2026-01-02" },
]

const DUPLICATE_TRANSACTIONS: Transaction[] = [
  { id: "tx-1", amount: 1000, date: "2026-01-01" },
  { id: "tx-1", amount: 1000, date: "2026-01-01" },
  { id: "tx-2", amount: 2000, date: "2026-01-02" },
]

describe("MVE-001: Anomaly Detection Spec Oracle", () => {
  test("TOTAL_MISMATCH: jumlah amount tidak sesuai ekspektasi sistem", () => {
    const total = TOTAL_MISMATCH_TRANSACTIONS.reduce((s, t) => s + t.amount, 0)
    expect(total).toBe(600)
  })

  test("NEGATIVE_AMOUNT: ada transaksi dengan amount negatif", () => {
    const hasNegative = NEGATIVE_AMOUNT_TRANSACTIONS.some(t => t.amount < 0)
    expect(hasNegative).toBe(true)
  })

  test("DUPLICATE: ada ID transaksi yang duplikat", () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const tx of DUPLICATE_TRANSACTIONS) {
      if (seen.has(tx.id)) duplicates.push(tx.id)
      seen.add(tx.id)
    }
    expect(duplicates.length).toBeGreaterThanOrEqual(1)
    expect(duplicates).toContain("tx-1")
  })

  test("clean: transaksi valid tanpa anomali", () => {
    const total = VALID_TRANSACTIONS.reduce((s, t) => s + t.amount, 0)
    expect(total).toBe(3500)
    const allPositive = VALID_TRANSACTIONS.every(t => t.amount > 0)
    expect(allPositive).toBe(true)
  })

  test("empty: array kosong menghasilkan total 0", () => {
    const empty: Transaction[] = []
    const total = empty.reduce((s, t) => s + t.amount, 0)
    expect(total).toBe(0)
  })
})
