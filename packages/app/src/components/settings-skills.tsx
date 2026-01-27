import { Component, For, Show, createSignal, onMount } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { usePlatform } from "@/context/platform"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { Icon } from "@opencode-ai/ui/icon"
import { Button } from "@opencode-ai/ui/button"

export interface SkillInfo {
  name: string
  description: string
  location: string
}

export const SettingsSkills: Component = () => {
  const language = useLanguage()
  const server = useServer()
  const platform = usePlatform()
  const [skills, setSkills] = createSignal<SkillInfo[]>([])
  const [isLoading, setIsLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  const fetchSkills = async () => {
    if (!server.url) {
      setError("No backend server configured")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const sdk = createOpencodeClient({
        baseUrl: server.url,
        fetch: platform.fetch,
      })

      const response = await sdk.app.skills()
      setSkills((response.data as SkillInfo[]) ?? [])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(`Failed to fetch skills: ${message}`)
      console.error("Error fetching skills:", err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleRefresh = () => {
    fetchSkills()
  }

  onMount(() => {
    fetchSkills()
  })

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar" style={{ padding: "0 40px 40px 40px" }}>
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <div class="flex items-center gap-2">
            <Icon name="code" size="normal" />
            <h2 class="text-16-medium text-text-strong">{language.t("settings.skills.title")}</h2>
          </div>
          <p class="text-14-regular text-text-weak">{language.t("settings.skills.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <div class="flex items-center justify-between pb-2">
            <h3 class="text-14-medium text-text-strong">{language.t("settings.section.available")}</h3>
            <Button
              size="small"
              variant="ghost"
              icon="arrows-clockwise"
              onClick={handleRefresh}
              disabled={isLoading()}
            >
              {language.t("common.refresh")}
            </Button>
          </div>

          <Show when={error()}>
            <div class="bg-background-warning-subtle px-4 py-3 rounded-lg">
              <div class="flex items-center gap-2 text-text-warning">
                <Icon name="warning-circle" class="w-4 h-4" />
                <span class="text-14-regular">{error()}</span>
              </div>
            </div>
          </Show>

          <div class="bg-surface-raised-base px-4 rounded-lg">
            <Show
              when={!isLoading() && skills().length > 0}
              fallback={
                <Show
                  when={isLoading()}
                  fallback={
                    <div class="py-8 text-center">
                      <Icon name="sparkles" class="w-12 h-12 mx-auto mb-3 text-icon-weak-subtle" />
                      <div class="text-14-regular text-text-weak">{language.t("settings.skills.empty")}</div>
                    </div>
                  }
                >
                  <div class="py-8 text-center">
                    <div class="inline-block w-6 h-6 border-2 border-border-strong-subtle border-t-transparent rounded-full animate-spin mb-3" />
                    <div class="text-14-regular text-text-weak">{language.t("settings.skills.loading")}</div>
                  </div>
                </Show>
              }
            >
              <For each={skills()}>
                {(skill) => (
                  <div class="flex items-start gap-3 py-3 border-b border-border-weak-base last:border-none px-2">
                    <Icon name="file-code" class="w-5 h-5 shrink-0 mt-0.5 text-icon-strong-subtle" />
                    <div class="flex flex-col gap-1 min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <span class="text-14-medium text-text-strong">{skill.name}</span>
                      </div>
                      <p class="text-13-regular text-text-weak line-clamp-2">{skill.description}</p>
                      <div class="flex items-center gap-1.5 text-12-regular text-text-weak">
                        <Icon name="folder" class="w-3.5 h-3.5" />
                        <span class="truncate font-mono">{skill.location}</span>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="flex flex-col gap-3 px-1">
          <h3 class="text-14-medium text-text-strong">{language.t("settings.skills.section.about")}</h3>
          <div class="text-13-regular text-text-weak space-y-2">
            <p>{language.t("settings.skills.about.description")}</p>
            <ul class="list-disc list-inside space-y-1 pl-2">
              <li>{language.t("settings.skills.about.item1")}</li>
              <li>{language.t("settings.skills.about.item2")}</li>
              <li>{language.t("settings.skills.about.item3")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
