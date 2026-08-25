import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type Accessor,
  type Component,
} from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type ContextSource = {
  key: string
  kind: "system" | "instructions" | "environment" | "skills" | "references"
  title: string
  path?: string
  editable: boolean
  content: string
}

export const SettingsContextV2: Component<{ directory: Accessor<string | undefined> }> = (props) => {
  const language = useLanguage()
  const serverSdk = useServerSDK()
  const serverSync = useServerSync()

  const location = createMemo(() => {
    const dir = props.directory()
    if (dir) return { directory: dir }
    const project = serverSync().data.project?.[0]
    return project?.worktree ? { directory: project.worktree } : undefined
  })

  const dirClient = createMemo(() => {
    const value = location()
    return value ? serverSdk().createClient({ directory: value.directory, throwOnError: true }) : undefined
  })

  const [selectedAgent, setSelectedAgent] = createSignal<string | undefined>()

  const [agents] = createResource(
    () => dirClient(),
    async (client) => {
      if (!client) return []
      const result = await client.v2.agent.list()
      return result.data?.data ?? []
    },
    { initialValue: [] },
  )

  createEffect(() => {
    if (selectedAgent()) return
    const list = agents()
    if (!list || list.length === 0) return
    setSelectedAgent(list.find((agent) => agent.id === "build")?.id ?? list[0].id)
  })

  const [sources, { refetch }] = createResource(
    () => [dirClient(), selectedAgent()] as const,
    async ([client, agent]) => {
      if (!client || !agent) return []
      const result = await client.v2.context.inspect({ agent })
      return result.data?.data ?? []
    },
    { initialValue: [] as ContextSource[] },
  )

  const [drafts, setDrafts] = createStore<Record<string, string | undefined>>({})
  const [saving, setSaving] = createSignal<string | undefined>()

  const editableSources = createMemo(() => sources().filter((source) => source.editable))
  const readOnlySources = createMemo(() => sources().filter((source) => !source.editable))

  const sourceTitle = (kind: ContextSource["kind"]) =>
    language.t(
      kind === "system"
        ? "settings.context.system.title"
        : kind === "instructions"
          ? "settings.context.instructions.title"
          : kind === "environment"
            ? "settings.context.environment.title"
            : kind === "skills"
              ? "settings.context.skills.title"
              : "settings.context.references.title",
    )

  const save = async (source: ContextSource) => {
    const client = dirClient()
    if (!client) return
    const content = drafts[source.key] ?? source.content
    setSaving(source.key)
    try {
      if (source.kind === "system") {
        const agent = selectedAgent()
        if (!agent) return
        await serverSync().updateConfig({ agent: { [agent]: { prompt: content } } })
      } else if (source.path) {
        await client.v2.context.writeInstruction({ contextWriteInstructionPayload: { path: source.path, content } })
      }
      setDrafts(source.key, undefined)
      void refetch()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.context.saveError"),
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setSaving(undefined)
    }
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h1 class="settings-v2-tab-title">{language.t("settings.tab.context")}</h1>
      </div>
      <div class="settings-v2-tab-body settings-v2-context">
        <Show
          when={location()}
          fallback={<div class="settings-v2-context-status">{language.t("settings.context.empty")}</div>}
        >
          <Show when={sources.error}>
            <div class="settings-v2-context-status">{language.t("settings.context.error")}</div>
          </Show>
          <section class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("settings.context.agent")}</h3>
            <SettingsListV2>
              <SettingsRowV2
                title={language.t("settings.context.agent")}
                description={language.t("settings.context.agent.description")}
              >
                <SelectV2
                  appearance="inline"
                  options={agents()}
                  current={agents().find((agent) => agent.id === selectedAgent())}
                  value={(agent) => agent.id}
                  label={(agent) => agent.id}
                  placeholder={language.t("settings.context.agent")}
                  onSelect={(agent) => setSelectedAgent(agent?.id)}
                />
              </SettingsRowV2>
            </SettingsListV2>
          </section>

          <Show when={editableSources().length > 0}>
            <section class="settings-v2-section">
              <h3 class="settings-v2-section-title">{language.t("settings.context.editable.title")}</h3>
              <SettingsListV2>
                <For each={editableSources()}>
                  {(source) => (
                    <SettingsRowV2
                      title={sourceTitle(source.kind)}
                      description={
                        source.path ??
                        (source.kind === "system"
                          ? language.t("settings.context.agent.description")
                          : language.t("settings.context.readOnly.title"))
                      }
                    >
                      <div class="settings-v2-context-editor">
                        <TextareaV2
                          class="!w-full [&_[data-slot=textarea-v2-textarea]]:font-mono"
                          rows={8}
                          spellcheck={false}
                          value={drafts[source.key] ?? source.content}
                          onInput={(event) => setDrafts(source.key, event.currentTarget.value)}
                        />
                        <div class="settings-v2-context-actions">
                          <ButtonV2
                            size="small"
                            variant="outline"
                            disabled={saving() === source.key}
                            onClick={() => void save(source)}
                          >
                            {language.t("settings.context.save")}
                          </ButtonV2>
                        </div>
                      </div>
                    </SettingsRowV2>
                  )}
                </For>
              </SettingsListV2>
            </section>
          </Show>

          <Show when={readOnlySources().length > 0}>
            <section class="settings-v2-section">
              <h3 class="settings-v2-section-title">{language.t("settings.context.readOnly.title")}</h3>
              <div class="settings-v2-context-sources">
                <For each={readOnlySources()}>
                  {(source) => (
                    <details class="settings-v2-context-source" open>
                      <summary>
                        <span class="settings-v2-context-source-title">{sourceTitle(source.kind)}</span>
                        <Show when={source.path}>
                          <span class="settings-v2-context-source-path">{source.path}</span>
                        </Show>
                        <Show when={source.content.length === 0}>
                          <span class="settings-v2-context-source-empty">
                            {language.t("settings.context.emptySource")}
                          </span>
                        </Show>
                      </summary>
                      <Show when={source.content.length > 0}>
                        <pre>{source.content}</pre>
                      </Show>
                    </details>
                  )}
                </For>
              </div>
            </section>
          </Show>
        </Show>
      </div>
    </>
  )
}
