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

interface ScoreDetail {
  criterion: string
  weight: number
  average: number
}

interface Run {
  task: string
  model: string
  agent: string
  score: {
    final: number
    base: number
    penalty: number
  }
  scoreDetails: ScoreDetail[]
}

interface Prompt {
  commit: string
  prompt: string
}

interface Task {
  averageScore: number
  summary?: string
  runs?: Run[]
  task: {
    id: string
    source: TaskSource
    prompts?: Prompt[]
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
            <th>Final Score</th>
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
            <div style={{ "margin-bottom": "1rem", color: "#000" }}>
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
            <Show when={modalTask()?.task.prompts && modalTask()!.task.prompts!.length > 0}>
              <div style={{ "margin-bottom": "1rem", color: "#000" }}>
                <strong>Prompt:</strong>
                <For each={modalTask()!.task.prompts}>
                  {(p) => (
                    <div style={{ "margin-top": "0.5rem" }}>
                      <div style={{ "font-size": "0.875rem", color: "#666" }}>Commit: {p.commit.slice(0, 7)}</div>
                      <p style={{ "margin-top": "0.25rem", "white-space": "pre-wrap" }}>{p.prompt}</p>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={modalTask()?.runs && modalTask()!.runs!.length > 0}>
              <div style={{ "margin-bottom": "1rem", color: "#000" }}>
                <strong>Runs:</strong>
                <table style={{ "margin-top": "0.5rem", "border-collapse": "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>Run</th>
                      <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>Final</th>
                      <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>Base</th>
                      <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>Penalty</th>
                      <For each={modalTask()!.runs![0]?.scoreDetails}>
                        {(detail) => (
                          <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>
                            {detail.criterion} ({detail.weight})
                          </th>
                        )}
                      </For>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={modalTask()!.runs}>
                      {(run, index) => (
                        <tr>
                          <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>{index() + 1}</td>
                          <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>{run.score.final.toFixed(3)}</td>
                          <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>{run.score.base.toFixed(3)}</td>
                          <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>
                            {run.score.penalty.toFixed(3)}
                          </td>
                          <For each={run.scoreDetails}>
                            {(detail) => (
                              <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>
                                {detail.average.toFixed(3)}
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <Show when={modalTask()?.summary}>
              <div style={{ "margin-bottom": "1rem", color: "#000" }}>
                <strong>Summary:</strong>
                <p style={{ "margin-top": "0.5rem", "white-space": "pre-wrap" }}>{modalTask()!.summary}</p>
              </div>
            </Show>
            <pre style={{ color: "#000" }}>{JSON.stringify(modalTask(), null, 2)}</pre>
          </div>
        </div>
      </Show>
    </main>
  )
}
