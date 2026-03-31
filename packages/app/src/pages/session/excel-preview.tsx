import { createSignal, createMemo, For, Show } from "solid-js"
import { read, utils } from "xlsx"
import { base64ToBytes } from "./preview-tab-helper"

export function ExcelPreview(props: { content: string; filename?: string }) {
  const [activeSheet, setActiveSheet] = createSignal(0)

  const workbook = createMemo(() => {
    try {
      const bytes = base64ToBytes(props.content)
      if (!bytes) return undefined
      return read(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
        type: "array",
      })
    } catch {
      return undefined
    }
  })

  const sheetNames = createMemo(() => workbook()?.SheetNames ?? [])

  const tableHtml = createMemo(() => {
    const wb = workbook()
    if (!wb) return ""
    const name = sheetNames()[activeSheet()]
    if (!name) return ""
    const sheet = wb.Sheets[name]
    if (!sheet) return ""
    return utils.sheet_to_html(sheet, { editable: false })
  })

  return (
    <div class="flex flex-col h-full min-h-0">
      <Show when={sheetNames().length > 1}>
        <div class="flex gap-1 px-4 py-2 border-b border-border-weak-base overflow-x-auto shrink-0">
          <For each={sheetNames()}>
            {(name, i) => (
              <button
                class={`px-3 py-1 text-12-medium rounded-md whitespace-nowrap transition-colors ${
                  activeSheet() === i()
                    ? "bg-background-strong text-text-strong"
                    : "text-text-weak hover:text-text-base hover:bg-background"
                }`}
                onClick={() => setActiveSheet(i())}
              >
                {name}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show
        when={workbook()}
        fallback={<div class="px-6 py-4 text-text-weak">Failed to parse spreadsheet</div>}
      >
        <div class="excel-preview flex-1 min-h-0 overflow-auto rounded-lg border border-border-weak-base" innerHTML={tableHtml()} />
      </Show>
    </div>
  )
}
