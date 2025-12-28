import { Title } from "@solidjs/meta"
import { createAsync, query } from "@solidjs/router"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Database, desc } from "@opencode-ai/console-core/drizzle/index.js"
import { BenchmarkTable } from "@opencode-ai/console-core/schema/benchmark.sql.js"

interface TaskSource {
  repo: string
  from: string
  to: string
}

interface Task {
  averageScore: number
  task: {
    id: string
    source: TaskSource
  }
}

interface BenchmarkResult {
  averageScore: number
  tasks: Task[]
}

async function getBenchmarks() {
  "use server"
  const rows = await Database.use((tx) =>
    tx.select().from(BenchmarkTable).orderBy(desc(BenchmarkTable.timeCreated)).limit(100),
  )
  return rows.map((row) => {
    const parsed = JSON.parse(row.result) as BenchmarkResult
    const taskScores: Record<string, number> = {}
    const taskData: Record<string, Task> = {}
    for (const t of parsed.tasks) {
      taskScores[t.task.id] = t.averageScore
      taskData[t.task.id] = t
    }
    return {
      agent: row.agent,
      model: row.model,
      averageScore: parsed.averageScore,
      taskScores,
      taskData,
    }
  })
}

const queryBenchmarks = query(getBenchmarks, "benchmarks.list")

export default function Bench() {
  const benchmarks = createAsync(() => queryBenchmarks())
  const [modalTask, setModalTask] = createSignal<Task | null>(null)

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
    <main data-page="bench">
      <Title>Benchmark</Title>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Model</th>
            <th>Average Score</th>
            <For each={taskIds()}>{(id) => <th>{id}</th>}</For>
          </tr>
        </thead>
        <tbody>
          <For each={benchmarks()}>
            {(row) => (
              <tr>
                <td>{row.agent}</td>
                <td>{row.model}</td>
                <td>{row.averageScore.toFixed(3)}</td>
                <For each={taskIds()}>
                  {(id) => (
                    <td>
                      <Show when={row.taskData[id]} fallback={row.taskScores[id]?.toFixed(3) ?? ""}>
                        <span
                          style={{ cursor: "pointer", "text-decoration": "underline" }}
                          onClick={() => setModalTask(row.taskData[id])}
                        >
                          {row.taskScores[id]?.toFixed(3)}
                        </span>
                      </Show>
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      <Show when={modalTask()}>
        <div
          data-component="modal-overlay"
          style={{
            position: "fixed",
            inset: "0",
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "z-index": "1000",
          }}
          onClick={() => setModalTask(null)}
        >
          <div
            data-component="modal"
            style={{
              background: "var(--color-background, #fff)",
              padding: "1rem",
              "border-radius": "8px",
              "max-width": "80vw",
              "max-height": "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ "margin-bottom": "1rem" }}>
              <div>
                <strong>Repo: </strong>
                <a
                  href={`https://github.com/${modalTask()!.task.source.repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#0066cc" }}
                >
                  {modalTask()!.task.source.repo}
                </a>
              </div>
              <div>
                <strong>From: </strong>
                <a
                  href={`https://github.com/${modalTask()!.task.source.repo}/commit/${modalTask()!.task.source.from}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#0066cc" }}
                >
                  {modalTask()!.task.source.from.slice(0, 7)}
                </a>
              </div>
              <div>
                <strong>To: </strong>
                <a
                  href={`https://github.com/${modalTask()!.task.source.repo}/commit/${modalTask()!.task.source.to}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#0066cc" }}
                >
                  {modalTask()!.task.source.to.slice(0, 7)}
                </a>
              </div>
            </div>
            <pre style={{ color: "#000" }}>{JSON.stringify(modalTask(), null, 2)}</pre>
          </div>
        </div>
      </Show>
    </main>
  )
}
