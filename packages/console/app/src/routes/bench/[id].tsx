import { Title } from "@solidjs/meta"
import { createAsync, query, useParams } from "@solidjs/router"
import { createSignal, For, Show } from "solid-js"
import { Database, desc, eq } from "@opencode-ai/console-core/drizzle/index.js"
import { BenchmarkTable } from "@opencode-ai/console-core/schema/benchmark.sql.js"
import { useI18n } from "~/context/i18n"

interface TaskSource {
  repo: string
  from: string
  to: string
}

interface Judge {
  score: number
  rationale: string
  judge: string
}

interface ScoreDetail {
  criterion: string
  weight: number
  average: number
  variance?: number
  judges?: Judge[]
}

interface RunUsage {
  input: number
  output: number
  cost: number
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
  usage?: RunUsage
  duration?: number
}

interface Prompt {
  commit: string
  prompt: string
}

interface AverageUsage {
  input: number
  output: number
  cost: number
}

interface Task {
  averageScore: number
  averageDuration?: number
  averageUsage?: AverageUsage
  model?: string
  agent?: string
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

async function getTaskDetail(benchmarkId: string, taskId: string) {
  "use server"
  const rows = await Database.use((tx) =>
    tx.select().from(BenchmarkTable).where(eq(BenchmarkTable.id, benchmarkId)).limit(1),
  )
  if (!rows[0]) return null
  const parsed = JSON.parse(rows[0].result) as BenchmarkResult
  const task = parsed.tasks.find((t) => t.task.id === taskId)
  return task ?? null
}

const queryTaskDetail = query(getTaskDetail, "benchmark.task.detail")

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${remainingSeconds}s`
}

export default function BenchDetail() {
  const params = useParams()
  const i18n = useI18n()
  const [benchmarkId, taskId] = (params.id ?? "").split(":")
  const task = createAsync(() => queryTaskDetail(benchmarkId, taskId))

  return (
    <main data-page="bench-detail">
      <Title>{i18n.t("bench.detail.title", { task: taskId })}</Title>
      <div style={{ padding: "1rem" }}>
        <Show when={task()} fallback={<p>{i18n.t("bench.detail.notFound")}</p>}>
          <div style={{ "margin-bottom": "1rem" }}>
            <div>
              <strong>{i18n.t("bench.detail.labels.agent")}: </strong>
              {task()?.agent ?? i18n.t("bench.detail.na")}
            </div>
            <div>
              <strong>{i18n.t("bench.detail.labels.model")}: </strong>
              {task()?.model ?? i18n.t("bench.detail.na")}
            </div>
            <div>
              <strong>{i18n.t("bench.detail.labels.task")}: </strong>
              {task()!.task.id}
            </div>
          </div>

          <div style={{ "margin-bottom": "1rem" }}>
            <div>
              <strong>{i18n.t("bench.detail.labels.repo")}: </strong>
              <a
                href={`https://github.com/${task()!.task.source.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#0066cc" }}
              >
                {task()!.task.source.repo}
              </a>
            </div>
            <div>
              <strong>{i18n.t("bench.detail.labels.from")}: </strong>
              <a
                href={`https://github.com/${task()!.task.source.repo}/commit/${task()!.task.source.from}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#0066cc" }}
              >
                {task()!.task.source.from.slice(0, 7)}
              </a>
            </div>
            <div>
              <strong>{i18n.t("bench.detail.labels.to")}: </strong>
              <a
                href={`https://github.com/${task()!.task.source.repo}/commit/${task()!.task.source.to}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#0066cc" }}
              >
                {task()!.task.source.to.slice(0, 7)}
              </a>
            </div>
          </div>

          <Show when={task()?.task.prompts && task()!.task.prompts!.length > 0}>
            <div style={{ "margin-bottom": "1rem" }}>
              <strong>{i18n.t("bench.detail.labels.prompt")}:</strong>
              <For each={task()!.task.prompts}>
                {(p) => (
                  <div style={{ "margin-top": "0.5rem" }}>
                    <div style={{ "font-size": "0.875rem", color: "#666" }}>
                      {i18n.t("bench.detail.labels.commit")}: {p.commit.slice(0, 7)}
                    </div>
                    <p style={{ "margin-top": "0.25rem", "white-space": "pre-wrap" }}>{p.prompt}</p>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <hr style={{ margin: "1rem 0", border: "none", "border-top": "1px solid #ccc" }} />

          <div style={{ "margin-bottom": "1rem" }}>
            <div>
              <strong>{i18n.t("bench.detail.labels.averageDuration")}: </strong>
              {task()?.averageDuration ? formatDuration(task()!.averageDuration!) : i18n.t("bench.detail.na")}
            </div>
            <div>
              <strong>{i18n.t("bench.detail.labels.averageScore")}: </strong>
              {task()?.averageScore?.toFixed(3) ?? i18n.t("bench.detail.na")}
            </div>
            <div>
              <strong>{i18n.t("bench.detail.labels.averageCost")}: </strong>
              {task()?.averageUsage?.cost ? `$${task()!.averageUsage!.cost.toFixed(4)}` : i18n.t("bench.detail.na")}
            </div>
          </div>

          <Show when={task()?.summary}>
            <div style={{ "margin-bottom": "1rem" }}>
              <strong>{i18n.t("bench.detail.labels.summary")}:</strong>
              <p style={{ "margin-top": "0.5rem", "white-space": "pre-wrap" }}>{task()!.summary}</p>
            </div>
          </Show>

          <Show when={task()?.runs && task()!.runs!.length > 0}>
            <div style={{ "margin-bottom": "1rem" }}>
              <strong>{i18n.t("bench.detail.labels.runs")}:</strong>
              <table style={{ "margin-top": "0.5rem", "border-collapse": "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>
                      {i18n.t("bench.detail.table.run")}
                    </th>
                    <th
                      style={{
                        border: "1px solid #ccc",
                        padding: "0.5rem",
                        "text-align": "left",
                        "white-space": "nowrap",
                      }}
                    >
                      {i18n.t("bench.detail.table.score")}
                    </th>
                    <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>
                      {i18n.t("bench.detail.table.cost")}
                    </th>
                    <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>
                      {i18n.t("bench.detail.table.duration")}
                    </th>
                    <For each={task()!.runs![0]?.scoreDetails}>
                      {(detail) => (
                        <th style={{ border: "1px solid #ccc", padding: "0.5rem", "text-align": "left" }}>
                          {detail.criterion} ({detail.weight})
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={task()!.runs}>
                    {(run, index) => (
                      <tr>
                        <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>{index() + 1}</td>
                        <td style={{ border: "1px solid #ccc", padding: "0.5rem", "white-space": "nowrap" }}>
                          {run.score.final.toFixed(3)} ({run.score.base.toFixed(3)} - {run.score.penalty.toFixed(3)})
                        </td>
                        <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>
                          {run.usage?.cost ? `$${run.usage.cost.toFixed(4)}` : i18n.t("bench.detail.na")}
                        </td>
                        <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>
                          {run.duration ? formatDuration(run.duration) : i18n.t("bench.detail.na")}
                        </td>
                        <For each={run.scoreDetails}>
                          {(detail) => (
                            <td style={{ border: "1px solid #ccc", padding: "0.5rem" }}>
                              <For each={detail.judges}>
                                {(judge) => (
                                  <span
                                    style={{
                                      color: judge.score === 1 ? "green" : judge.score === 0 ? "red" : "inherit",
                                      "margin-right": "0.25rem",
                                    }}
                                  >
                                    {judge.score === 1 ? "✓" : judge.score === 0 ? "✗" : judge.score}
                                  </span>
                                )}
                              </For>
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
              <For each={task()!.runs}>
                {(run, index) => (
                  <div style={{ "margin-top": "1rem" }}>
                    <h3 style={{ margin: "0 0 0.5rem 0" }}>{i18n.t("bench.detail.run.title", { n: index() + 1 })}</h3>
                    <div>
                      <strong>{i18n.t("bench.detail.labels.score")}: </strong>
                      {run.score.final.toFixed(3)} ({i18n.t("bench.detail.labels.base")}: {run.score.base.toFixed(3)} -{" "}
                      {i18n.t("bench.detail.labels.penalty")}: {run.score.penalty.toFixed(3)})
                    </div>
                    <For each={run.scoreDetails}>
                      {(detail) => (
                        <div style={{ "margin-top": "1rem", "padding-left": "1rem", "border-left": "2px solid #ccc" }}>
                          <div>
                            {detail.criterion} ({i18n.t("bench.detail.labels.weight")}: {detail.weight}){" "}
                            <For each={detail.judges}>
                              {(judge) => (
                                <span
                                  style={{
                                    color: judge.score === 1 ? "green" : judge.score === 0 ? "red" : "inherit",
                                    "margin-right": "0.25rem",
                                  }}
                                >
                                  {judge.score === 1 ? "✓" : judge.score === 0 ? "✗" : judge.score}
                                </span>
                              )}
                            </For>
                          </div>
                          <Show when={detail.judges && detail.judges.length > 0}>
                            <For each={detail.judges}>
                              {(judge) => {
                                const [expanded, setExpanded] = createSignal(false)
                                return (
                                  <div style={{ "margin-top": "0.5rem", "padding-left": "1rem" }}>
                                    <div
                                      style={{ "font-size": "0.875rem", cursor: "pointer" }}
                                      onClick={() => setExpanded(!expanded())}
                                    >
                                      <span style={{ "margin-right": "0.5rem" }}>{expanded() ? "▼" : "▶"}</span>
                                      <span
                                        style={{
                                          color: judge.score === 1 ? "green" : judge.score === 0 ? "red" : "inherit",
                                        }}
                                      >
                                        {judge.score === 1 ? "✓" : judge.score === 0 ? "✗" : judge.score}
                                      </span>{" "}
                                      {judge.judge}
                                    </div>
                                    <Show when={expanded()}>
                                      <p
                                        style={{
                                          margin: "0.25rem 0 0 0",
                                          "white-space": "pre-wrap",
                                          "font-size": "0.875rem",
                                        }}
                                      >
                                        {judge.rationale}
                                      </p>
                                    </Show>
                                  </div>
                                )
                              }}
                            </For>
                          </Show>
                        </div>
                      )}
                    </For>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {(() => {
            const [jsonExpanded, setJsonExpanded] = createSignal(false)
            return (
              <div style={{ "margin-top": "1rem" }}>
                <button
                  style={{
                    cursor: "pointer",
                    padding: "0.75rem 1.5rem",
                    "font-size": "1rem",
                    background: "#f0f0f0",
                    border: "1px solid #ccc",
                    "border-radius": "4px",
                  }}
                  onClick={() => setJsonExpanded(!jsonExpanded())}
                >
                  <span style={{ "margin-right": "0.5rem" }}>{jsonExpanded() ? "▼" : "▶"}</span>
                  {i18n.t("bench.detail.rawJson")}
                </button>
                <Show when={jsonExpanded()}>
                  <pre>{JSON.stringify(task(), null, 2)}</pre>
                </Show>
              </div>
            )
          })()}
        </Show>
      </div>
    </main>
  )
}
