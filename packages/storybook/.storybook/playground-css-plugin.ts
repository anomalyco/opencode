/**
 * Vite plugin that exposes a POST endpoint for the timeline playground
 * to write CSS changes back to source files on disk.
 *
 * POST /__playground/apply-css
 * Body: { edits: Array<{ file: string; anchor: string; prop: string; value: string }> }
 *
 * For each edit the plugin finds `anchor` in the file, then locates the
 * next `prop: <anything>;` after it and replaces the value portion.
 * `file` is a basename resolved relative to packages/ui/src/components/.
 */
import type { Plugin } from "vite"
import type { IncomingMessage, ServerResponse } from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "../../ui/src/components")

const ENDPOINT = "/__playground/apply-css"

type Edit = { file: string; anchor: string; prop: string; value: string }
type Result = { file: string; prop: string; ok: boolean; error?: string }

function applyEdits(content: string, edits: Edit[]): { content: string; results: Result[] } {
  const results: Result[] = []
  let out = content

  for (const edit of edits) {
    const name = edit.file
    const idx = out.indexOf(edit.anchor)
    if (idx === -1) {
      results.push({ file: name, prop: edit.prop, ok: false, error: `Anchor not found: ${edit.anchor.slice(0, 50)}` })
      continue
    }

    // From the anchor position, find the next occurrence of `prop: <value>`
    // We match `prop:` followed by any value up to `;`
    const after = out.slice(idx)
    const re = new RegExp(`(${escapeRegex(edit.prop)}\\s*:\\s*)([^;]+)(;)`)
    const match = re.exec(after)
    if (!match) {
      results.push({ file: name, prop: edit.prop, ok: false, error: `Property "${edit.prop}" not found after anchor` })
      continue
    }

    const start = idx + match.index + match[1].length
    const end = start + match[2].length
    out = out.slice(0, start) + edit.value + out.slice(end)
    results.push({ file: name, prop: edit.prop, ok: true })
  }

  return { content: out, results }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function playgroundCss(): Plugin {
  return {
    name: "playground-css",
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        if (req.url !== ENDPOINT) return next()
        if (req.method !== "POST") {
          res.statusCode = 405
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: "Method not allowed" }))
          return
        }

        let data = ""
        req.on("data", (chunk: Buffer) => {
          data += chunk.toString()
        })
        req.on("end", () => {
          let payload: { edits: Edit[] }
          try {
            payload = JSON.parse(data)
          } catch {
            res.statusCode = 400
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: "Invalid JSON" }))
            return
          }

          if (!Array.isArray(payload.edits)) {
            res.statusCode = 400
            res.setHeader("Content-Type", "application/json")
            res.end(JSON.stringify({ error: "Missing edits array" }))
            return
          }

          // Group by file
          const grouped = new Map<string, Edit[]>()
          for (const edit of payload.edits) {
            if (!edit.file || !edit.anchor || !edit.prop || edit.value === undefined) continue
            const abs = path.resolve(root, edit.file)
            if (!abs.startsWith(root)) continue
            const key = abs
            if (!grouped.has(key)) grouped.set(key, [])
            grouped.get(key)!.push(edit)
          }

          const results: Result[] = []

          for (const [abs, edits] of grouped) {
            const name = path.basename(abs)
            if (!fs.existsSync(abs)) {
              for (const e of edits) results.push({ file: name, prop: e.prop, ok: false, error: "File not found" })
              continue
            }

            try {
              const content = fs.readFileSync(abs, "utf-8")
              const applied = applyEdits(content, edits)
              results.push(...applied.results)

              if (applied.results.some((r) => r.ok)) {
                fs.writeFileSync(abs, applied.content, "utf-8")
              }
            } catch (err) {
              for (const e of edits) results.push({ file: name, prop: e.prop, ok: false, error: String(err) })
            }
          }

          res.statusCode = 200
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ results }))
        })
      })
    },
  }
}
