import path from "path"
import os from "os"
import fs from "fs/promises"
import { createMemo, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import * as fuzzysort from "fuzzysort"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"

export function DialogCd(props: { onSelect?: (value: string) => void }) {
  const dialog = useDialog()
  const sync = useSync()
  const [store, setStore] = createStore({
    filter: "",
  })

  const [dirs] = createResource(
    () => store.filter,
    async (filter) => {
      const base = sync.data.path.directory || process.cwd()
      const raw = filter.trim()
      const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw
      const full = raw ? (path.isAbsolute(expanded) ? expanded : path.resolve(base, expanded)) : base
      const dir = raw.endsWith("/") || raw.endsWith(path.sep) || !raw ? full : path.dirname(full)
      const name = raw.endsWith("/") || raw.endsWith(path.sep) ? "" : path.basename(full)
      const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
      const items = list
        .filter((x) => x.isDirectory())
        .map((x) => path.join(dir, x.name))

      if (!name) return items.sort().slice(0, 50)
      return fuzzysort.go(name, items, { limit: 50 }).map((x) => x.target)
    },
  )

  const options = createMemo(() =>
    (dirs() ?? []).map((dir) => ({
      value: dir,
      title: path.basename(dir) || dir,
      description: dir,
    })),
  )

  return (
    <DialogSelect
      title="Change directory"
      placeholder="Type a path..."
      options={options()}
      flat
      onFilter={(filter) => {
        setStore("filter", filter)
      }}
      onSelect={(option) => {
        props.onSelect?.(option.value)
        dialog.clear()
      }}
    />
  )
}
