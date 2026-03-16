import { Component, createMemo, createResource, Show } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Tag } from "@opencode-ai/ui/tag"
import { useLanguage } from "@/context/language"

export const DialogSelectSkill: Component<{ onSelect: (skill: string) => void }> = (props) => {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()

  const [skills] = createResource(async () => {
    const result = await sdk.client.app.skills()
    return result.data ?? []
  })

  const items = createMemo(() =>
    (skills() ?? [])
      .map((s) => ({ name: s.name, description: s.description }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )

  return (
    <Dialog title={language.t("dialog.skill.title")}>
      <List
        search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
        emptyMessage={language.t("dialog.skill.empty")}
        key={(x) => x?.name ?? ""}
        items={items}
        filterKeys={["name", "description"]}
        sortBy={(a, b) => a.name.localeCompare(b.name)}
        onSelect={(x) => {
          if (!x) return
          props.onSelect(x.name)
          dialog.close()
        }}
      >
        {(i) => (
          <div class="w-full flex items-center gap-x-3">
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="truncate">{i.name}</span>
              <Show when={i.description}>
                <span class="text-11-regular text-text-weaker truncate">{i.description}</span>
              </Show>
            </div>
          </div>
        )}
      </List>
    </Dialog>
  )
}
