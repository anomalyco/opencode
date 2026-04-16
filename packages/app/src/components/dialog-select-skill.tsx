import { Component, createMemo, createResource } from "solid-js"
import { useSDK } from "@/context/sdk"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { useLanguage } from "@/context/language"

type SkillItem = {
  name: string
  description?: string
}

// Cache by directory so project-local skills don't get replaced by another workspace's list.
const cachedSkills = new Map<string, SkillItem[]>()
const cachedSkillsPromise = new Map<string, Promise<SkillItem[]>>()

const loadSkills = async (sdk: ReturnType<typeof useSDK>): Promise<SkillItem[]> => {
  const dir = sdk.directory

  // Return cached data immediately if available
  const cached = cachedSkills.get(dir)
  if (cached) return cached

  // Return in-flight promise if already loading
  const pending = cachedSkillsPromise.get(dir)
  if (pending) return pending

  // Start loading and cache the promise
  const task = (async () => {
    const result = await sdk.client.app.skills({}, { throwOnError: true })
    const skills = (result.data ?? []).map((item) => ({
      name: item.name,
      description: item.description,
    }))
    cachedSkills.set(dir, skills)
    cachedSkillsPromise.delete(dir)
    return skills
  })()

  cachedSkillsPromise.set(dir, task)
  return task
}

export const DialogSelectSkill: Component = () => {
  const sdk = useSDK()
  const language = useLanguage()

  // Use sdk.client as source to only reload if client changes
  // Provide cached data as initialValue to avoid flash of empty state
  const [skills] = createResource(
    () => sdk.client,
    () => loadSkills(sdk),
    { initialValue: cachedSkills.get(sdk.directory) },
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
