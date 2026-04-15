import { Component, createMemo, createResource } from "solid-js"
import { usePrompt } from "@/context/prompt"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useLanguage } from "@/context/language"

type SkillItem = {
  name: string
  description?: string
}

// Module-level cache to avoid re-fetching on every dialog open
let cachedSkills: SkillItem[] | undefined = undefined
let cachedSkillsPromise: Promise<SkillItem[]> | undefined = undefined

const loadSkills = async (sdk: ReturnType<typeof useSDK>): Promise<SkillItem[]> => {
  // Return cached data immediately if available
  if (cachedSkills) return cachedSkills

  // Return in-flight promise if already loading
  if (cachedSkillsPromise) return cachedSkillsPromise

  // Start loading and cache the promise
  cachedSkillsPromise = (async () => {
    const result = await sdk.client.app.skills({}, { throwOnError: true })
    const skills = (result.data ?? []).map((item) => ({
      name: item.name,
      description: item.description,
    }))
    cachedSkills = skills
    cachedSkillsPromise = undefined // Clear promise cache after completion
    return skills
  })()

  return cachedSkillsPromise
}

export const DialogSelectSkill: Component = () => {
  const sdk = useSDK()
  const prompt = usePrompt()
  const dialog = useDialog()
  const language = useLanguage()

  // Use sdk.client as source to only reload if client changes
  // Provide cached data as initialValue to avoid flash of empty state
  const [skills] = createResource(
    () => sdk.client,
    () => loadSkills(sdk),
    { initialValue: cachedSkills },
  )

  const items = createMemo(() => (skills() ?? []).toSorted((a, b) => a.name.localeCompare(b.name)))

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
