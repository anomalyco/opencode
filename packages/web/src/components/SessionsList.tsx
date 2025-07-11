import { Show, createSignal } from "solid-js"
import {
  createSolidTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
} from "@tanstack/solid-table"
import type { SortingState, ColumnFiltersState } from "@tanstack/solid-table"
import { createColumns } from "./SessionsList/columns"
import { createGlobalFilterFn } from "./SessionsList/utils"
import type { SessionData, SessionsListProps } from "./SessionsList/types"
import Header from "./SessionsList/Header"
import SessionsTable from "./SessionsList/Table"
import ErrorState from "./SessionsList/ErrorState"
import EmptyState from "./SessionsList/EmptyState"
import HelpSection from "./SessionsList/HelpSection"
import styles from "./SessionsList/SessionsList.module.css"

export type { SessionData, SessionsListProps }

export default function SessionsList(props: SessionsListProps) {
  const [globalFilter, setGlobalFilter] = createSignal("")
  const [sorting, setSorting] = createSignal<SortingState>([
    {
      id: "time.updated",
      desc: true,
    },
  ])
  const [columnFilters, setColumnFilters] = createSignal<ColumnFiltersState>([])

  const columns = createColumns(props.basePath)

  const table = createSolidTable({
    get data() {
      return props.sessions
    },
    columns,
    state: {
      get sorting() {
        return sorting()
      },
      get globalFilter() {
        return globalFilter()
      },
      get columnFilters() {
        return columnFilters()
      },
    },
    columnResizeMode: "onChange",
    enableColumnResizing: true,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: createGlobalFilterFn(),
  })


  return (
    <div class={styles.localSessions}>
      <Header
        title={props.title}
        sessions={props.sessions}
        error={props.error}
        globalFilter={globalFilter()}
        onGlobalFilterChange={setGlobalFilter}
      />

      <Show when={props.error}>
        <ErrorState error={props.error || ""} apiUrl={props.apiUrl} />
      </Show>

      <Show when={!props.error}>
        <Show when={props.sessions.length === 0}>
          <EmptyState message={props.emptyMessage} />
        </Show>

        <Show when={props.sessions.length > 0}>
          <SessionsTable table={table} />
        </Show>
      </Show>

      <Show when={props.helpText}>
        <HelpSection>
          <div innerHTML={props.helpText} />
        </HelpSection>
      </Show>
    </div>
  )
}
