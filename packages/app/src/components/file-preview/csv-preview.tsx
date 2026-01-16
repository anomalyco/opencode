import { Show, createMemo, For } from "solid-js"
import type { CsvPreviewProps } from "./types"

/**
 * Parse CSV content into rows and columns
 * Handles quoted fields and escaped quotes
 */
function parseCsv(content: string, delimiter: string): string[][] {
  const rows: string[][] = []
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    if (line.trim() === "") continue

    const row: string[] = []
    let current = ""
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      const nextChar = line[i + 1]

      if (inQuotes) {
        if (char === '"' && nextChar === '"') {
          // Escaped quote
          current += '"'
          i++
        } else if (char === '"') {
          // End of quoted field
          inQuotes = false
        } else {
          current += char
        }
      } else {
        if (char === '"') {
          // Start of quoted field
          inQuotes = true
        } else if (char === delimiter) {
          // Field separator
          row.push(current)
          current = ""
        } else {
          current += char
        }
      }
    }

    // Push last field
    row.push(current)
    rows.push(row)
  }

  return rows
}

/**
 * CSV/TSV Preview component that displays data in a formatted table.
 */
export function CsvPreview(props: CsvPreviewProps) {
  const delimiter = () => props.delimiter ?? ","

  // Parse CSV content
  const parsedData = createMemo(() => {
    return parseCsv(props.content, delimiter())
  })

  // Get header row (first row)
  const headers = createMemo(() => {
    const data = parsedData()
    return data.length > 0 ? data[0] : []
  })

  // Get data rows (all except first)
  const dataRows = createMemo(() => {
    const data = parsedData()
    return data.length > 1 ? data.slice(1) : []
  })

  // Calculate column count
  const columnCount = createMemo(() => {
    const data = parsedData()
    return Math.max(...data.map((row) => row.length), 0)
  })

  // Stats
  const stats = createMemo(() => {
    const data = parsedData()
    return {
      rows: data.length,
      columns: columnCount(),
    }
  })

  return (
    <div
      data-component="csv-preview"
      class={props.class ?? ""}
    >
      {/* Stats header */}
      <div data-slot="csv-header">
        <span class="csv-stats">
          {stats().rows} rows × {stats().columns} columns
        </span>
        <span class="csv-type">
          {delimiter() === "\t" ? "TSV" : "CSV"}
        </span>
      </div>

      {/* Table */}
      <div data-slot="csv-table-container">
        <Show
          when={parsedData().length > 0}
          fallback={
            <div class="csv-empty">No data to display</div>
          }
        >
          <table data-slot="csv-table">
            <thead>
              <tr>
                <th class="row-number">#</th>
                <For each={headers()}>
                  {(header, index) => (
                    <th title={header}>
                      {header || `Column ${index() + 1}`}
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody>
              <For each={dataRows()}>
                {(row, rowIndex) => (
                  <tr>
                    <td class="row-number">{rowIndex() + 1}</td>
                    <For each={Array.from({ length: columnCount() })}>
                      {(_, colIndex) => (
                        <td title={row[colIndex()] ?? ""}>
                          {row[colIndex()] ?? ""}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>

      <Show when={props.truncated}>
        <div data-slot="truncation-notice">
          Content truncated. Showing first 100KB.
        </div>
      </Show>
    </div>
  )
}
