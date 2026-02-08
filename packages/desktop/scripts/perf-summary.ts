import path from "node:path"

type Event = {
  seq?: number
  kind: "rust" | "frontend" | string
  name: string
  at_ms?: number | null
  ts_ms?: number | null
  data?: unknown
}

const file = process.argv[2]
if (!file) {
  console.error("Usage: bun run --cwd packages/desktop perf:summary <path-to-jsonl>")
  process.exit(1)
}

const text = await Bun.file(file).text().catch(() => "")
if (!text.trim()) {
  console.error(`No data in ${path.resolve(file)}`)
  process.exit(1)
}

const events = text
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0)
  .filter((line) => line.startsWith("{"))
  .map((line) => JSON.parse(line) as Event)

const at = (kind: string, name: string) =>
  events.find((e) => e.kind === kind && e.name === name)?.at_ms ?? null

const dur = (kind: string, start: string, end: string) => {
  const a = at(kind, start)
  const b = at(kind, end)
  if (a === null || b === null) return null
  return b - a
}

const span = (kind: string, name: string) => dur(kind, `${name}:start`, `${name}:end`)

const out = (label: string, ms: number | null) => {
  if (ms === null) return
  console.log(label.padEnd(34), ms.toFixed(1), "ms")
}

console.log(path.resolve(file))
out("rust window build", dur("rust", "window_build_start", "window_built"))
out("rust sidecar spawn", dur("rust", "sidecar_spawn_start", "sidecar_spawn_ready"))
out("rust server connect", dur("rust", "server_connect_start", "server_ready"))
out("frontend ensure_server_ready", span("frontend", "ensure_server_ready"))
out("frontend start -> server ready", dur("frontend", "frontend_start", "server_ready_resolved"))
out("frontend sessions load", dur("frontend", "sessions_load_start", "sessions_load_end"))
out("frontend sessions list", span("frontend", "sessions_list"))
