#!/usr/bin/env bun
import { createReadStream } from "node:fs"
import { Schema } from "effect"

const Header = Schema.Struct({
  snapshot: Schema.Struct({
    node_count: Schema.Number,
    meta: Schema.Struct({
      node_fields: Schema.Array(Schema.String),
      node_types: Schema.Array(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
    }),
  }),
})

type Total = { count: number; bytes: number; detached: number }

export type HeapSummary = Map<string, Total>

/** Streams V8's nodes, skips edges, then resolves only constructor names from the string table.
 * Memory is bounded by constructor cardinality (capped at 250k), not heap nodes or edges.
 * This is a shallow-size census, not a retained-size or retaining-path analysis.
 */
export async function summarize(file: string): Promise<HeapSummary> {
  const totals = new Map<number, Map<string, Total>>()
  const summary: HeapSummary = new Map()
  let buffer = ""
  let phase: "header" | "nodes" | "skip" | "strings" | "done" = "header"
  let header: typeof Header.Type | undefined
  let types: readonly string[] = []
  let fields: readonly string[] = []
  let row: number[] = []
  let nodes = 0
  let names = 0
  let stringIndex = 0
  let quoted = false
  let escaped = false
  let token = ""
  let wanted = false
  let nameCharacters = 0

  for await (const chunk of createReadStream(file, { encoding: "utf8", highWaterMark: 64 * 1024 })) {
    buffer += chunk

    if (phase === "header") {
      const start = /"nodes"\s*:\s*\[/.exec(buffer)

      if (!start) {
        if (buffer.length > 1024 * 1024) throw new Error("Heap header exceeds 1 MiB")
        continue
      }

      header = Schema.decodeUnknownSync(Header)(JSON.parse(buffer.slice(0, start.index).replace(/,\s*$/, "") + "}"))
      fields = header.snapshot.meta.node_fields
      const table = header.snapshot.meta.node_types[fields.indexOf("type")]

      if (!Array.isArray(table) || ["type", "name", "self_size"].some((field) => !fields.includes(field)))
        throw new Error("Unsupported heap node layout")
      types = table
      buffer = buffer.slice(start.index + start[0].length)
      phase = "nodes"
    }

    if (phase === "nodes") {
      // Keep a number split across chunks; never retain the numeric nodes array.
      const tokens = /\d+|\]/g
      let consumed = 0

      for (const match of buffer.matchAll(tokens)) {
        if (match[0] === "]") {
          if (row.length || nodes !== header?.snapshot.node_count) throw new Error("Incomplete heap nodes")
          consumed = match.index + 1
          phase = "skip"
          break
        }

        if (match.index + match[0].length === buffer.length) {
          consumed = match.index
          break
        }

        row.push(Number(match[0]))
        consumed = match.index + match[0].length

        if (row.length !== fields.length) continue
        const type = types[row[fields.indexOf("type")]]

        if (!type) throw new Error("Unknown heap node type")
        const named = type === "object" || type === "native" || type === "closure"
        const name = named ? row[fields.indexOf("name")] : -1
        let group = totals.get(name)

        if (!group) {
          if (++names > 250_000) throw new Error("Heap exceeds 250k distinct constructor names")
          group = new Map()
          totals.set(name, group)
        }

        const total = group.get(type) ?? { count: 0, bytes: 0, detached: 0 }
        total.count++
        total.bytes += row[fields.indexOf("self_size")]

        if (type === "native" && row[fields.indexOf("detachedness")] === 2) total.detached++
        group.set(type, total)
        row = []
        nodes++
      }

      buffer = buffer.slice(consumed)
    }

    if (phase === "skip") {
      const start = /"strings"\s*:\s*\[/.exec(buffer)

      if (!start) {
        buffer = buffer.slice(-64)
        continue
      }

      buffer = buffer.slice(start.index + start[0].length)
      phase = "strings"
    }

    if (phase === "strings") {
      // Unneeded strings (including arbitrarily large source text) are skipped without buffering them.
      for (const char of buffer) {
        if (!quoted) {
          if (char === "]") {
            phase = "done"
            break
          }

          if (char !== '"') continue
          quoted = true
          wanted = totals.has(stringIndex)
          token = wanted ? '"' : ""
          continue
        }

        if (wanted) {
          token += char

          if (token.length > 64 * 1024) throw new Error("Constructor name exceeds 64 Ki characters")
        }

        if (escaped) {
          escaped = false
          continue
        }

        if (char === "\\") {
          escaped = true
          continue
        }

        if (char !== '"') continue

        if (wanted) {
          const name: string = JSON.parse(token)
          nameCharacters += name.length

          if (nameCharacters > 16 * 1024 * 1024) throw new Error("Constructor names exceed 16 Mi characters")
          const group = totals.get(stringIndex)
          group?.forEach((total, type) => {
            const detached = type === "native" && name.startsWith("Detached ") ? total.count : total.detached
            const key = `${type}: ${name}`
            const prior = summary.get(key) ?? { count: 0, bytes: 0, detached: 0 }
            summary.set(key, {
              count: prior.count + total.count,
              bytes: prior.bytes + total.bytes,
              detached: prior.detached + detached,
            })
          })
          totals.delete(stringIndex)
        }

        stringIndex++
        quoted = false
      }

      buffer = ""
    }

    if (phase === "done") break
  }

  if (phase !== "done" || [...totals.keys()].some((key) => key !== -1)) throw new Error("Incomplete heap string table")
  totals.get(-1)?.forEach((total, type) => summary.set(`(${type})`, total))

  return summary
}

export function compare(before: HeapSummary, after: HeapSummary) {
  return [...new Set([...before.keys(), ...after.keys()])].map((name) => {
    const a = before.get(name)
    const b = after.get(name)

    return { name, count: (b?.count ?? 0) - (a?.count ?? 0), bytes: (b?.bytes ?? 0) - (a?.bytes ?? 0) }
  })
}

if (import.meta.main) {
  const [before, after] = process.argv.slice(2)

  if (!before || !after) throw new Error("Usage: bun scripts/heap-diff.ts BEFORE.heapsnapshot AFTER.heapsnapshot")
  const a = await summarize(before)
  const b = await summarize(after)
  const rows = compare(a, b)
  console.log("Top count deltas (after - before)")
  console.table(rows.toSorted((a, b) => b.count - a.count).slice(0, 20))
  console.log("Top self-size deltas in bytes (not retained size)")
  console.table(rows.toSorted((a, b) => b.bytes - a.bytes).slice(0, 20))
  const detached = (heap: HeapSummary) => [...heap.values()].reduce((sum, row) => sum + row.detached, 0)
  console.log(
    JSON.stringify({ detachedDOM: { before: detached(a), after: detached(b), delta: detached(b) - detached(a) } }),
  )
}
