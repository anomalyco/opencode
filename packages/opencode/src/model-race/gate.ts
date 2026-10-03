import type { Tool } from "ai"

export class ToolNotWinnerError extends Error {
  constructor(candidateID: string) {
    super(`Model race candidate did not win: ${candidateID}`)
  }
}

type Deferred = {
  promise: Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
  settled: boolean
}

export class ToolExecutionGate {
  readonly #states = new Map<string, Deferred>()
  readonly #cancelled = new Set<string>()
  readonly #candidates: Set<string>
  #winner: string | undefined

  constructor(candidates: string[] = []) {
    this.#candidates = new Set(candidates)
  }

  wait(candidateID: string) {
    if (this.#winner === candidateID) return Promise.resolve()
    if (this.#cancelled.has(candidateID)) return Promise.reject(new ToolNotWinnerError(candidateID))
    const existing = this.#states.get(candidateID)
    if (existing) return existing.promise

    let resolve!: () => void
    let reject!: (error: unknown) => void
    const deferred: Deferred = {
      promise: new Promise<void>((done, fail) => {
        resolve = done
        reject = fail
      }),
      resolve,
      reject,
      settled: false,
    }
    this.#states.set(candidateID, deferred)
    return deferred.promise
  }

  allowWinner(candidateID: string) {
    this.#winner = candidateID
    for (const id of this.#candidates) {
      if (id !== candidateID) this.#cancelled.add(id)
    }

    const winner = this.#states.get(candidateID)
    if (winner && !winner.settled) {
      winner.settled = true
      this.#states.delete(candidateID)
      winner.resolve()
    }

    for (const [id, state] of [...this.#states]) {
      if (state.settled) continue
      state.settled = true
      this.#states.delete(id)
      state.reject(new ToolNotWinnerError(id))
    }
  }

  cancel(candidateID: string) {
    this.#cancelled.add(candidateID)
    const state = this.#states.get(candidateID)
    if (!state || state.settled) return
    state.settled = true
    this.#states.delete(candidateID)
    state.reject(new ToolNotWinnerError(candidateID))
  }
}

export function gateTools(tools: Record<string, Tool>, candidateID: string, gate: ToolExecutionGate) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, item]) => {
      if (!item.execute) return [name, item]
      return [
        name,
        {
          ...item,
          execute: async (...args: Parameters<NonNullable<typeof item.execute>>) => {
            await gate.wait(candidateID)
            return item.execute!(...args)
          },
        },
      ]
    }),
  ) as Record<string, Tool>
}
