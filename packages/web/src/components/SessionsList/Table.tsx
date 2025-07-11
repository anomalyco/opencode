import { Show, For } from "solid-js"
import { flexRender } from "@tanstack/solid-table"
import type { Table } from "@tanstack/solid-table"
import type { SessionData } from "./types"
import styles from "./Table.module.css"

interface TableProps {
  table: Table<SessionData>
}

export default function SessionsTable(props: TableProps) {
  return (
    <div class={styles.tableContainer}>
      <div class={styles.tableWrapper}>
        <table class={styles.table}>
          <thead>
            <For each={props.table.getHeaderGroups()}>
              {(headerGroup) => (
                <tr>
                  <For each={headerGroup.headers}>
                    {(header) => (
                      <th
                        style={{
                          "max-width": `${header.getSize()}px`,
                          "min-width": `${header.getSize()}px`,
                          position: "relative",
                        }}
                        class={`column-${header.column.id}`}
                        classList={{
                          [styles.sortable]: header.column.getCanSort(),
                          [styles.sorted]: header.column.getIsSorted() !== false,
                        }}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div class={styles.headerContent}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <Show when={header.column.getCanSort()}>
                            <span class={styles.sortIndicator}>
                              {header.column.getIsSorted() === "asc"
                                ? "↑"
                                : header.column.getIsSorted() === "desc"
                                  ? "↓"
                                  : "↕"}
                            </span>
                          </Show>
                        </div>
                        <Show when={header.column.getCanResize()}>
                          <div
                            classList={{
                              [styles.resizeHandle]: true,
                              [styles.isResizing]: header.column.getIsResizing(),
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                            }}
                            onMouseDown={header.getResizeHandler()}
                            onTouchStart={header.getResizeHandler()}
                          />
                        </Show>
                      </th>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </thead>
          <tbody>
            <For each={props.table.getRowModel().rows}>
              {(row) => (
                <tr>
                  <For each={row.getVisibleCells()}>
                    {(cell) => (
                      <td
                        class={`column-${cell.column.id}`}
                        style={{
                          "max-width": `${cell.column.getSize()}px`,
                          "min-width": `${cell.column.getSize()}px`,
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      <Show when={props.table.getRowModel().rows.length === 0}>
        <p class={styles.noResults}>No sessions match your search.</p>
      </Show>
    </div>
  )
}