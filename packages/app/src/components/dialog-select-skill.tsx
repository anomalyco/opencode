import { Component, createMemo } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useLanguage } from "@/context/language"
import { useGlobalSync } from "@/context/global-sync"
import { useSkills } from "@/context/skills"
import { skill } from "@/components/status-popover-data"

export const DialogSelectSkill: Component = () => {
  const global = useGlobalSync()
  const skills = useSkills()
  const language = useLanguage()

  const items = createMemo(() =>
    skills
      .list()
      .map((item) => ({ ...item, meta: skill(item, global.data.project) }))
      .toSorted((a, b) => a.name.localeCompare(b.name)),
  )

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
      >
        {(item) => (
          <div class="w-full flex items-center gap-2">
            <span class="text-14-regular text-text-strong whitespace-nowrap">/{item.name}</span>
            <span class="text-12-regular text-text-weak whitespace-nowrap">{item.meta.scope}</span>
            <span class="text-12-regular text-text-weak whitespace-nowrap">{item.meta.source ?? "-"}</span>
            <span class="text-14-regular text-text-weak truncate">{item.description}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
