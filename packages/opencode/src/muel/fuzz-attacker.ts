export interface Transaction {
  id: string
  amount: number
  date: string
  description?: string
}

export type AnomalyType = "TOTAL_MISMATCH" | "NEGATIVE_AMOUNT" | "DUPLICATE"

export interface Anomaly {
  type: AnomalyType
  transactionId?: string
  details: string
}

export interface FuzzResult {
  total: number
  passed: number
  failed: number
  errors: string[]
  failures: Array<{ input: Transaction[]; error: Error }>
}

export interface DiffEntry {
  inputIndex: number
  outputA: unknown
  outputB: unknown
  crashA: boolean
  crashB: boolean
}

export type FuzzFunction = (input: Transaction[]) => unknown

export class FuzzAttacker {
  generateInputs(count: number): Transaction[][] {
    if (count <= 0) return []
    const result: Transaction[][] = []
    for (let i = 0; i < count; i++) {
      const txs: Transaction[] = []
      const txCount = Math.max(1, Math.floor(Math.random() * 4) + 1)
      for (let j = 0; j < txCount; j++) {
        const id = `tx-${i}-${j}`
        let amount = Math.floor(Math.random() * 10000) + 1
        if (i % 4 === 1 && j === 0) amount = -amount
        txs.push({
          id,
          amount,
          date: new Date(Date.now() + j * 1000).toISOString(),
        })
      }
      if (i % 4 === 2 && txs.length > 1) {
        txs.push({ ...txs[0], id: `duplicate-${i}` })
      }
      if (i % 4 === 3) {
        txs.push({ id: "", amount: 0, date: "" })
      }
      result.push(txs)
    }
    return result
  }

  fuzzTest(fn: FuzzFunction, inputs: Transaction[][]): FuzzResult {
    let passed = 0
    let failed = 0
    const errors: string[] = []
    const failures: Array<{ input: Transaction[]; error: Error }> = []
    for (const input of inputs) {
      try {
        fn(input)
        passed++
      } catch (e) {
        failed++
        const err = e instanceof Error ? e : new Error(String(e))
        errors.push(err.message)
        failures.push({ input, error: err })
      }
    }
    return { total: inputs.length, passed, failed, errors, failures }
  }

  behavioralDiff(
    fnA: FuzzFunction,
    fnB: FuzzFunction,
    inputs: Transaction[][],
  ): DiffEntry[] {
    const diffs: DiffEntry[] = []
    for (let i = 0; i < inputs.length; i++) {
      let outputA: unknown
      let outputB: unknown
      let crashA = false
      let crashB = false
      try { outputA = fnA(inputs[i]) } catch { crashA = true }
      try { outputB = fnB(inputs[i]) } catch { crashB = true }
      if (crashA !== crashB || JSON.stringify(outputA) !== JSON.stringify(outputB)) {
        diffs.push({ inputIndex: i, outputA, outputB, crashA, crashB })
      }
    }
    return diffs
  }
}
