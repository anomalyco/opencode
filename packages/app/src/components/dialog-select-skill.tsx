import { Component, createMemo, createResource } from "solid-js"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useLanguage } from "@/context/language"
import { cachedSkills, loadSkills } from "@/utils/skills"

export const DialogSelectSkill: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()

  // Use sdk.client as source to only reload if client changes
  // Provide cached data as initialValue to avoid flash of empty state
  const [skills] = createResource(
    () => sdk.client,
    () => loadSkills(sdk),
    { initialValue: cachedSkills(sdk.directory) },
  )

  const items = createMemo(() => (skills() ?? []).toSorted((a, b) => a.name.localeCompare(b.name)))

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
            <span class="text-14-regular text-text-weak truncate">{item.description}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
