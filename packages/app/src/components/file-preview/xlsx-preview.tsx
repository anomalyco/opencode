import { Show, createSignal, createEffect, on, createMemo, For } from "solid-js"
import * as XLSX from "xlsx"
import type { XlsxPreviewProps } from "./types"

/**
 * XLSX Preview component that renders Excel spreadsheets using SheetJS.
 */
export function XlsxPreview(props: XlsxPreviewProps) {
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [workbook, setWorkbook] = createSignal<XLSX.WorkBook | null>(null)
  const [activeSheet, setActiveSheet] = createSignal<string>("")

  // Parse Excel when content changes
  createEffect(
    on(
      () => props.content,
      (content) => {
        if (!content) return

        setLoading(true)
        setError(null)

        try {
          // Convert base64 to ArrayBuffer
          const binaryString = atob(content)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }

          // Parse the workbook
          const wb = XLSX.read(bytes, { type: "array" })
          setWorkbook(wb)

          // Set first sheet as active
          if (wb.SheetNames.length > 0) {
            setActiveSheet(wb.SheetNames[0])
          }
        } catch (e) {
          console.error("[XlsxPreview] Parse error:", e)
          setError("Failed to parse spreadsheet. The file may be corrupted or in an unsupported format.")
        } finally {
          setLoading(false)
        }
      },
      { defer: false }
    )
  )

  // Get sheet names
  const sheetNames = createMemo(() => {
    const wb = workbook()
    return wb?.SheetNames ?? []
  })

  // Get current sheet data as 2D array
  const sheetData = createMemo(() => {
    const wb = workbook()
    const sheetName = activeSheet()
    if (!wb || !sheetName) return []

    const sheet = wb.Sheets[sheetName]
    if (!sheet) return []

    // Convert sheet to JSON array of arrays
    const data = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    })

    // Limit rows for performance
    const maxRows = 1000
    return data.slice(0, maxRows)
  })

  // Get column count (max columns across all rows)
  const columnCount = createMemo(() => {
    const data = sheetData()
    return Math.max(...data.map((row) => row.length), 0)
  })

  // Generate column headers (A, B, C, ... Z, AA, AB, etc.)
  const columnHeaders = createMemo(() => {
    const count = columnCount()
    const headers: string[] = []
    for (let i = 0; i < count; i++) {
      headers.push(getColumnLabel(i))
    }
    return headers
  })

  return (
    <div
      data-component="xlsx-preview"
      class={props.class ?? ""}
    >
      {/* Loading state */}
      <Show when={loading()}>
        <div data-slot="xlsx-loading">
          <svg class="w-5 h-5 animate-spin" viewBox="0 0 16 16" fill="none">
            <circle
              cx="8"
              cy="8"
              r="6"
              stroke="currentColor"
              stroke-width="2"
              stroke-dasharray="28"
              stroke-dashoffset="7"
            />
          </svg>
          <span>Loading spreadsheet...</span>
        </div>
      </Show>

      {/* Error state */}
      <Show when={error()}>
        <div data-slot="xlsx-error">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14,2 14,8 20,8" />
            <line x1="12" y1="18" x2="12" y2="12" />
            <line x1="12" y1="9" x2="12.01" y2="9" />
          </svg>
          <span>{error()}</span>
        </div>
      </Show>

      {/* Spreadsheet content */}
      <Show when={!loading() && !error() && workbook()}>
        {/* Sheet tabs */}
        <Show when={sheetNames().length > 1}>
          <div data-slot="xlsx-tabs">
            <For each={sheetNames()}>
              {(name) => (
                <button
                  type="button"
                  classList={{ active: activeSheet() === name }}
                  onClick={() => setActiveSheet(name)}
                >
                  {name}
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Stats */}
        <div data-slot="xlsx-header">
          <span class="xlsx-stats">
            {sheetData().length} rows × {columnCount()} columns
          </span>
          <Show when={sheetNames().length === 1}>
            <span class="xlsx-sheet-name">{activeSheet()}</span>
          </Show>
        </div>

        {/* Table */}
        <div data-slot="xlsx-table-container">
          <Show
            when={sheetData().length > 0}
            fallback={
              <div class="xlsx-empty">This sheet is empty</div>
            }
          >
            <table data-slot="xlsx-table">
              <thead>
                <tr>
                  <th class="row-number"></th>
                  <For each={columnHeaders()}>
                    {(header) => <th>{header}</th>}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={sheetData()}>
                  {(row, rowIndex) => (
                    <tr>
                      <td class="row-number">{rowIndex() + 1}</td>
                      <For each={Array.from({ length: columnCount() })}>
                        {(_, colIndex) => (
                          <td title={String(row[colIndex()] ?? "")}>
                            {formatCellValue(row[colIndex()])}
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

        <Show when={sheetData().length >= 1000}>
          <div data-slot="truncation-notice">
            Showing first 1000 rows for performance.
          </div>
        </Show>
      </Show>
    </div>
  )
}

/**
 * Convert column index to Excel-style label (A, B, ... Z, AA, AB, etc.)
 */
function getColumnLabel(index: number): string {
  let label = ""
  let n = index
  while (n >= 0) {
    label = String.fromCharCode((n % 26) + 65) + label
    n = Math.floor(n / 26) - 1
  }
  return label
}

/**
 * Format cell value for display
 */
function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") {
    // Format numbers nicely
    if (Number.isInteger(value)) return value.toString()
    return value.toFixed(2)
  }
  return String(value)
}
