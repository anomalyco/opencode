import { readFileSync } from "node:fs"
import type { Dataset, Trace } from "./types.ts"

/** Load an evaluation dataset (cases + recorded traces) from a JSON file. */
export function loadDataset(path: string): Dataset {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<Dataset>
  return normalizeDataset(parsed)
}

export function normalizeDataset(input: Partial<Dataset>): Dataset {
  const cases = (input.cases ?? []).map((c) => ({
    ...c,
    expectKeywords: c.expectKeywords ?? [],
    forbidKeywords: c.forbidKeywords ?? [],
  }))
  const traces = input.traces ?? []
  return { cases, traces }
}

/** The failing traces are the reflection signal: *why* the skill fell short. */
export function failingTraces(dataset: Dataset): Trace[] {
  return dataset.traces.filter((t) => !t.success)
}

/** Group traces by their case id for quick lookup during reflection. */
export function tracesByCase(dataset: Dataset): Map<string, Trace[]> {
  const map = new Map<string, Trace[]>()
  for (const trace of dataset.traces) {
    const list = map.get(trace.caseId) ?? []
    list.push(trace)
    map.set(trace.caseId, list)
  }
  return map
}
