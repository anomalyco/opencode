import { Component, createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useLanguage } from "@/context/language"
import { useDialog } from "@opencode-ai/ui/context/dialog"

export const DialogListSubagents: Component = () => {
  const sync = useSync()
  const language = useLanguage()
  const dialog = useDialog()

  const subagents = createMemo(() =>
    sync.data.agent
      .filter((item) => item.mode === "subagent" && !item.hidden)
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  return (
    <Dialog title={language.t("dialog.subagent.title")}>
      <List
        class="flex-1 min-h-0 [&_[data-slot=list-scroll]]:flex-1 [&_[data-slot=list-scroll]]:min-h-0"
        search={{ placeholder: language.t("dialog.subagent.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.subagent.empty")}
        key={(x) => x.name}
        items={subagents}
        filterKeys={["name", "description"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={() => dialog.close()}
      >
        {(item) => (
          <div class="w-full flex items-center gap-x-2 text-13-regular">
            <span class="text-text-strong whitespace-nowrap">{item.name}</span>
            <span class="text-text-weak truncate">{item.description}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
