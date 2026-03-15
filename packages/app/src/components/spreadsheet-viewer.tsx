import * as XLSX from "xlsx"
import {
  createSolidTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/solid-table"
import { createStore } from "solid-js/store"
import { createMemo, For, Show, createEffect, on } from "solid-js"
import { useSDK } from "@/context/sdk"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@opencode-ai/ui/table"

export async function parseSpreadsheetBuffer(buf: ArrayBuffer) {
  const workbook = XLSX.read(buf)
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  })
  return { sheetName, rows }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer as ArrayBuffer
}

function makeColumns(rows: Record<string, unknown>[]): ColumnDef<Record<string, unknown>>[] {
  const first = rows[0] ?? {}
  return Object.keys(first).map((key) => ({
    accessorKey: key,
    header: key,
  }))
}

type State = {
  data: Record<string, unknown>[]
  columns: ColumnDef<Record<string, unknown>>[]
  sheetName: string
  globalFilter: string
  loading: boolean
  error: string | null
}

type Props = {
  filePath?: string
}

export function SpreadsheetViewer(props: Props) {
  const sdk = useSDK()

  const [state, setState] = createStore<State>({
    data: [],
    columns: [],
    sheetName: "",
    globalFilter: "",
    loading: false,
    error: null,
  })

  createEffect(
    on(
      () => props.filePath,
      async (path) => {
        if (!path) return
        setState({ loading: true, error: null })
        try {
          const response = await sdk.client.file.read({ path })
          const content = response.data
          if (!content) {
            setState({ error: "Failed to load file", loading: false })
            return
          }
          if (content.type === "binary" && !content.encoding) {
            setState({ error: "Cannot read binary file", loading: false })
            return
          }
          let buf: ArrayBuffer
          if (content.type === "binary" && content.encoding === "base64") {
            buf = base64ToArrayBuffer(content.content)
          } else {
            const encoded = new TextEncoder().encode(content.content)
            buf = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer
          }
          const { rows, sheetName } = await parseSpreadsheetBuffer(buf)
          setState({
            data: rows,
            columns: makeColumns(rows),
            sheetName,
            globalFilter: "",
            loading: false,
            error: null,
          })
        } catch (e) {
          setState({
            error: e instanceof Error ? e.message : "Failed to load file",
            loading: false,
          })
        }
      },
    ),
  )

  const table = createMemo(() =>
    createSolidTable({
      get data() {
        return state.data
      },
      get columns() {
        return state.columns
      },
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
      getFilteredRowModel: getFilteredRowModel(),
      state: {
        get globalFilter() {
          return state.globalFilter
        },
      },
      onGlobalFilterChange: (updater) => {
        const value = typeof updater === "function" ? updater(state.globalFilter) : updater
        setState("globalFilter", value)
      },
      globalFilterFn: "includesString",
    }),
  )

  return (
    <div class="flex flex-col gap-4 w-full h-full">
      <Show when={state.loading}>
        <div class="flex items-center justify-center h-full">
          <span class="text-muted-foreground">Loading spreadsheet...</span>
        </div>
      </Show>

      <Show when={state.error}>
        <div class="flex flex-col items-center justify-center h-full gap-2">
          <span class="text-destructive">{state.error}</span>
        </div>
      </Show>

      <Show when={!state.loading && !state.error && state.data.length > 0}>
        <div class="flex items-center justify-between px-1">
          <h3 class="text-sm font-medium text-muted-foreground">{state.sheetName}</h3>
          <input
            type="text"
            placeholder="Search..."
            value={state.globalFilter}
            onInput={(e) => setState("globalFilter", e.currentTarget.value)}
            class="px-3 py-1.5 text-sm border rounded-md bg-background border-input h-8 w-[200px]"
          />
        </div>

        <div class="rounded-md border">
          <Table>
            <TableHeader>
              <For each={table().getHeaderGroups()}>
                {(headerGroup) => (
                  <TableRow>
                    <For each={headerGroup.headers}>
                      {(header) => (
                        <TableHead class="cursor-pointer select-none" onClick={header.column.getToggleSortingHandler()}>
                          <div class="flex items-center gap-2">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <Show when={header.column.getIsSorted() === "asc"}>
                              <span class="text-xs">↑</span>
                            </Show>
                            <Show when={header.column.getIsSorted() === "desc"}>
                              <span class="text-xs">↓</span>
                            </Show>
                          </div>
                        </TableHead>
                      )}
                    </For>
                  </TableRow>
                )}
              </For>
            </TableHeader>
            <TableBody>
              <For each={table().getRowModel().rows}>
                {(row) => (
                  <TableRow>
                    <For each={row.getVisibleCells()}>
                      {(cell) => <TableCell>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>}
                    </For>
                  </TableRow>
                )}
              </For>
            </TableBody>
          </Table>
        </div>

        <div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
          <span>
            {table().getRowModel().rows.length} of {state.data.length} rows
          </span>
          <Show when={state.globalFilter}>
            <span>Filtered by: "{state.globalFilter}"</span>
          </Show>
        </div>
      </Show>
    </div>
  )
}
