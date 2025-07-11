import { createColumnHelper } from "@tanstack/solid-table"
import { For } from "solid-js"
import { ProviderIcon } from "../share/part"
import { formatRelativeTime } from "../../utils/time"
import type { SessionData } from "./types"
import styles from "./Table.module.css"

const columnHelper = createColumnHelper<SessionData>()

export const createColumns = (basePath?: string) => [
  columnHelper.accessor("title", {
    header: "Title",
    size: 200,
    cell: (info) => (
      <a
        href={`${basePath}/${info.row.original.id}`}
        title={info.getValue()?.trim()}
        class={`${styles.sessionLink} ${styles.sessionTitleClamp}`}
      >
        {info.getValue()?.trim() || "(no title)"}
      </a>
    ),
  }),
  columnHelper.accessor("time.updated", {
    header: "Last Updated",
    size: 130,
    cell: (info) => {
      const updated = info.getValue()
      if (!updated) return "—"

      return <span title={new Date(updated).toLocaleString()}>{formatRelativeTime(updated)}</span>
    },
  }),
  columnHelper.accessor("computedData.created", {
    header: "Started",
    size: 130,
    cell: (info) => {
      const created = info.getValue()
      if (!created) return "—"

      return <span title={new Date(created).toLocaleString()}>{formatRelativeTime(created)}</span>
    },
  }),
  columnHelper.accessor("computedData.models", {
    header: "Models",
    size: 200,
    cell: (info) => {
      const models = info.getValue()
      const modelEntries = Object.values(models)
      if (modelEntries.length === 0) return "—"

      return (
        <div class={styles.modelsCell}>
          <For each={modelEntries}>
            {(item) => (
              <div class={styles.modelItem} title={`${item[0]} - ${item[1]}`}>
                <div class={styles.modelIcon}>
                  <ProviderIcon model={item[1]} />
                </div>
                <span class={styles.modelName}>{item[1]}</span>
              </div>
            )}
          </For>
        </div>
      )
    },
    filterFn: (row, columnId, value) => {
      const models = row.getValue(columnId) as Record<string, string[]>
      const modelEntries = Object.values(models)
      return modelEntries.some(
        ([provider, model]) =>
          provider.toLowerCase().includes(value.toLowerCase()) || model.toLowerCase().includes(value.toLowerCase()),
      )
    },
  }),
  columnHelper.accessor("computedData.cost", {
    header: "Cost",
    size: 100,
    cell: (info) => {
      const cost = info.getValue()
      return cost !== undefined ? `$${cost.toFixed(2)}` : "—"
    },
  }),
  columnHelper.accessor("computedData.tokens.input", {
    header: "Input",
    size: 100,
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("computedData.tokens.output", {
    header: "Output",
    size: 100,
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("computedData.tokens.reasoning", {
    header: "Reasoning",
    size: 100,
    cell: (info) => info.getValue() || "—",
  }),
  columnHelper.accessor("version", {
    header: "Version",
    size: 100,
    cell: (info) => `v${info.getValue() || "0.0.1"}`,
  }),
]