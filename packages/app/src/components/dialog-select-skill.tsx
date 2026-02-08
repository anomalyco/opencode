import { Component, createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import { usePrompt } from "@/context/prompt"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useLanguage } from "@/context/language"

interface SkillItem {
  name: string
  description?: string
  source?: string
}

export const DialogSelectSkill: Component = () => {
  const sync = useSync()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()

  const items = createMemo((): SkillItem[] =>
    sync.data.command
      .filter((cmd) => cmd.source === "skill")
      .map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  const handleSelect = (item: SkillItem | undefined) => {
    if (!item) return
    const text = `/${item.name} `
    dialog.close()
    requestAnimationFrame(() => {
      prompt.set([{ type: "text", content: text, start: 0, end: text.length }], text.length)
    })
  }

  return (
    <Dialog
      title={language.t("dialog.skill.title")}
      description={language.t("dialog.skill.description", { count: items().length })}
    >
      <List
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.skill.empty")}
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "description"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={handleSelect}
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="text-14-regular text-text-strong whitespace-nowrap">/{item.name}</span>
            <span class="text-14-regular text-text-weak truncate">{item.description}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
