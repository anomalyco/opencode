import { Title } from "@solidjs/meta"
import { A, createAsync, query } from "@solidjs/router"
import { createMemo, For, Show } from "solid-js"
import { Database, desc } from "@opencode-ai/console-core/drizzle/index.js"
import { BenchmarkTable } from "@opencode-ai/console-core/schema/benchmark.sql.js"

interface BenchmarkResult {
  averageScore: number
  tasks: { averageScore: number; task: { id: string } }[]
}

async function getBenchmarks() {
  "use server"
  const rows = await Database.use((tx) =>
    tx.select().from(BenchmarkTable).orderBy(desc(BenchmarkTable.timeCreated)).limit(100),
  )
  return rows.map((row) => {
    const parsed = JSON.parse(row.result) as BenchmarkResult
    const taskScores: Record<string, number> = {}
    for (const t of parsed.tasks) {
      taskScores[t.task.id] = t.averageScore
    }
    return {
      id: row.id,
      agent: row.agent,
      model: row.model,
      averageScore: parsed.averageScore,
      taskScores,
    }
  })
}

const queryBenchmarks = query(getBenchmarks, "benchmarks.list")

export default function Bench() {
  const benchmarks = createAsync(() => queryBenchmarks())

  const taskIds = createMemo(() => {
    const ids = new Set<string>()
    for (const row of benchmarks() ?? []) {
      for (const id of Object.keys(row.taskScores)) {
        ids.add(id)
      }
    }
    return [...ids].sort()
  })

  return (
    <main data-page="bench" style={{ padding: "2rem" }}>
      <Title>Benchmark</Title>
      <h1 style={{ "margin-bottom": "1.5rem" }}>Benchmarks</h1>
      <table style={{ "border-collapse": "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ "text-align": "left", padding: "0.75rem" }}>Agent</th>
            <th style={{ "text-align": "left", padding: "0.75rem" }}>Model</th>
            <th style={{ "text-align": "left", padding: "0.75rem" }}>Score</th>
            <For each={taskIds()}>{(id) => <th style={{ "text-align": "left", padding: "0.75rem" }}>{id}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={benchmarks()}>
            {(row) => (
              <tr>
                <td style={{ padding: "0.75rem" }}>{row.agent}</td>
                <td style={{ padding: "0.75rem" }}>{row.model}</td>
                <td style={{ padding: "0.75rem" }}>{row.averageScore.toFixed(3)}</td>
                <For each={taskIds()}>
                  {(id) => (
                    <td style={{ padding: "0.75rem" }}>
                      <Show when={row.taskScores[id] !== undefined} fallback="">
                        <A href={`/bench/${row.id}:${id}`} style={{ color: "#0066cc" }}>
                          {row.taskScores[id]?.toFixed(3)}
                        </A>
                      </Show>
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </main>
  )
}
