#!/usr/bin/env bun
import fs from "node:fs/promises"

interface TraceEntry {
  timestamp: string
  session_id: string
  task_id: string
  tool_id: string
  input_chars: number
  output_chars: number
  success: boolean
  retry: boolean
  wall_time_ms: number
}

async function loadEntries(): Promise<TraceEntry[]> {
  const raw = await fs.readFile("tool_trace.jsonl", "utf-8").catch(() => "")
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l))
}

function groupBy<K, V>(items: V[], key: (v: V) => K): Map<K, V[]> {
  return items.reduce((map, item) => {
    const k = key(item)
    const arr = map.get(k) ?? []
    arr.push(item)
    map.set(k, arr)
    return map
  }, new Map<K, V[]>())
}

function countBy<V>(items: V[], key: (v: V) => string): Record<string, number> {
  return items.reduce((acc, item) => {
    const k = key(item)
    acc[k] = (acc[k] || 0) + 1
    return acc
  }, {} as Record<string, number>)
}

function summarize(entries: TraceEntry[]) {
  const inputChars = entries.reduce((s, e) => s + e.input_chars, 0)
  const outputChars = entries.reduce((s, e) => s + e.output_chars, 0)
  const toolCalls = entries.length
  const wallTimeSec = entries.reduce((s, e) => s + e.wall_time_ms, 0) / 1000
  const allSuccess = entries.every((e) => e.success)
  const toolCounts = countBy(entries, (e) => e.tool_id)
  return { inputChars, outputChars, toolCalls, wallTimeSec, allSuccess, toolCounts }
}

async function main() {
  const entries = await loadEntries()
  const bySession = groupBy(entries, (e) => e.session_id)
  const rows: Record<string, string | number | boolean>[] = []

  for (const [sessionId, sessionEntries] of bySession) {
    const byTask = groupBy(sessionEntries, (e) => e.task_id || "unknown")
    for (const [taskId, taskEntries] of byTask) {
      const s = summarize(taskEntries)
      rows.push({
        session_id: sessionId,
        task_id: taskId,
        input_chars: s.inputChars,
        est_tokens: Math.round(s.inputChars / 4),
        output_chars: s.outputChars,
        tool_calls: s.toolCalls,
        tools_used: Object.entries(s.toolCounts).map(([k, v]) => `${k}:${v}`).join(", "),
        success_first_attempt: s.allSuccess,
        wall_time_sec: s.wallTimeSec.toFixed(2),
      })
    }
  }

  console.log("| session_id | task_id | input_chars | est_tokens | output_chars | tool_calls | tools_used | success_first | wall_time_sec |")
  console.log("|------------|---------|-------------|------------|--------------|------------|------------|---------------|---------------|")
  for (const r of rows) {
    console.log(`| ${r.session_id} | ${r.task_id} | ${r.input_chars} | ${r.est_tokens} | ${r.output_chars} | ${r.tool_calls} | ${r.tools_used} | ${r.success_first_attempt} | ${r.wall_time_sec} |`)
  }

  const csvFlag = process.argv.indexOf("--csv")
  if (csvFlag !== -1) {
    const file = process.argv[csvFlag + 1]
    if (file) {
      const header = "session_id,task_id,input_chars,est_tokens,output_chars,tool_calls,tools_used,success_first_attempt,wall_time_sec"
      const lines = rows.map((r) => `${r.session_id},${r.task_id},${r.input_chars},${r.est_tokens},${r.output_chars},${r.tool_calls},"${r.tools_used}",${r.success_first_attempt},${r.wall_time_sec}`)
      await fs.writeFile(file, [header, ...lines].join("\n"))
      console.log(`\nCSV written to ${file}`)
    }
  }

  const baseline = rows.filter((r) => String(r.session_id).startsWith("baseline"))
  const ast = rows.filter((r) => String(r.session_id).startsWith("ast"))
  if (baseline.length && ast.length) {
    const sum = (arr: typeof rows, key: keyof (typeof rows)[0]) => arr.reduce((s, r) => s + (Number(r[key]) || 0), 0)
    const bInput = sum(baseline, "input_chars")
    const aInput = sum(ast, "input_chars")
    const saved = bInput > 0 ? (((bInput - aInput) / bInput) * 100).toFixed(1) : "0.0"
    const bTools = countBy(entries.filter((e) => String(e.session_id).startsWith("baseline")), (e) => e.tool_id)
    const aTools = countBy(entries.filter((e) => String(e.session_id).startsWith("ast")), (e) => e.tool_id)
    console.log("\n--- Comparative Summary ---")
    console.log(`Baseline total input chars:  ${bInput}`)
    console.log(`AST total input chars:       ${aInput}`)
    console.log(`Token savings:               ${saved}%`)
    console.log(`Baseline total output chars: ${sum(baseline, "output_chars")}`)
    console.log(`AST total output chars:      ${sum(ast, "output_chars")}`)
    console.log(`Baseline total tool calls:   ${sum(baseline, "tool_calls")}`)
    console.log(`AST total tool calls:        ${sum(ast, "tool_calls")}`)
    console.log(`\nBaseline tool breakdown:    ${Object.entries(bTools).map(([k, v]) => `${k}:${v}`).join(", ")}`)
    console.log(`AST tool breakdown:         ${Object.entries(aTools).map(([k, v]) => `${k}:${v}`).join(", ")}`)
  }
}

main()
