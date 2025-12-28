import { Title } from "@solidjs/meta"
import { createAsync, query } from "@solidjs/router"
import { For } from "solid-js"
import { Database, desc } from "@opencode-ai/console-core/drizzle/index.js"
import { BenchmarkTable } from "@opencode-ai/console-core/schema/benchmark.sql.js"

async function getBenchmarks() {
  "use server"
  const rows = await Database.use((tx) =>
    tx.select().from(BenchmarkTable).orderBy(desc(BenchmarkTable.timeCreated)).limit(100),
  )
  return rows.map((row) => {
    const parsed = JSON.parse(row.result) as { averageScore: number }
    return {
      agent: row.agent,
      model: row.model,
      averageScore: parsed.averageScore,
    }
  })
}

const queryBenchmarks = query(getBenchmarks, "benchmarks.list")

export default function Bench() {
  const benchmarks = createAsync(() => queryBenchmarks())

  return (
    <main data-page="bench">
      <Title>Benchmark</Title>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Model</th>
            <th>Average Score</th>
          </tr>
        </thead>
        <tbody>
          <For each={benchmarks()}>
            {(row) => (
              <tr>
                <td>{row.agent}</td>
                <td>{row.model}</td>
                <td>{row.averageScore}</td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </main>
  )
}
