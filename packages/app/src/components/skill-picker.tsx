import { Component, createMemo, createResource, createSignal, Match, Show, Switch } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"
import { makeEventListener } from "@solid-primitives/event-listener"

interface SkillItem {
  name: string
  description?: string
  type: "core" | "non-core"
  loaded: boolean
}

export const SkillPicker: Component = () => {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [width, setWidth] = createSignal(window.innerWidth)
  const [highlighted, setHighlighted] = createSignal<string | undefined>()

  makeEventListener(window, "resize", () => setWidth(window.innerWidth))

  const [skills, { refetch }] = createResource(async () => {
    const res = await fetch(`${sdk().url}/skills?directory=${encodeURIComponent(sdk().directory)}`, {
      headers: { "x-opencode-directory": encodeURIComponent(sdk().directory) },
    })
    if (!res.ok) return []
    return (await res.json()) as SkillItem[]
  })

  const coreSkills = createMemo(() => skills()?.filter((s) => s.type === "core") ?? [])
  const nonCoreSkills = createMemo(() => skills()?.filter((s) => s.type === "non-core") ?? [])

  const handleLoad = async (name: string) => {
    try {
      const res = await fetch(`${sdk().url}/skills/load?directory=${encodeURIComponent(sdk().directory)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-opencode-directory": encodeURIComponent(sdk().directory),
        },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) return
      refetch()
    } catch {
      // ignore
    }
  }

  const [previewContent, setPreviewContent] = createSignal<string | undefined>()

  let pendingPreview: string | undefined
  const fetchPreview = (name: string | undefined) => {
    pendingPreview = name
    if (!name || !previewEnabled()) {
      setPreviewContent(undefined)
      return
    }
    void (async () => {
      if (pendingPreview !== name) return
      try {
        const url = `${sdk().url}/skills/content?name=${encodeURIComponent(name)}&directory=${encodeURIComponent(sdk().directory)}`
        const res = await fetch(url, {
          headers: { "x-opencode-directory": encodeURIComponent(sdk().directory) },
        })
        if (pendingPreview !== name) return
        if (!res.ok) return
        const data = await res.json()
        if (pendingPreview !== name) return
        setPreviewContent(data.content.substring(0, 2000))
      } catch {
        // ignore
      }
    })()
  }

  const previewEnabled = createMemo(() => width() >= 120)

  const wideLayout = (content: any) => (
    <div class="flex gap-3" style="max-height: min(70vh, 600px);">
      <div class="flex-1 min-w-0">{content}</div>
      <Show when={previewEnabled()}>
        <div class="w-80 shrink-0 border-l border-border-default pl-3 overflow-y-auto">
          <Show when={highlighted()} fallback={<div class="text-12-regular text-text-weaker p-2">{language.t("command.skills.preview.hint")}</div>}>
            <div class="flex items-center gap-2 mb-2">
              <span class="text-12-medium text-text-default truncate">{highlighted()}</span>
            </div>
            <Switch>
              <Match when={previewContent() === undefined}>
                <div class="text-12-regular text-text-weaker p-2">{language.t("common.loading")}</div>
              </Match>
              <Match when={previewContent() !== undefined}>
                <pre class="text-12-regular text-text-default whitespace-pre-wrap break-words font-mono leading-relaxed p-2 rounded-sm bg-bg-subtle">{previewContent()}</pre>
              </Match>
            </Switch>
          </Show>
        </div>
      </Show>
    </div>
  )

  const listContent = (
    <List
      class="px-3"
      search={{ placeholder: language.t("common.search.placeholder"), autofocus: true }}
      emptyMessage={language.t("command.skills.empty")}
      loadingMessage={language.t("common.loading")}
      key={(x: SkillItem) => x.name}
      items={skills() ?? []}
      filterKeys={["name", "description"]}
      groupBy={(x) => (x.type === "core" ? language.t("command.skills.group.core") : language.t("command.skills.group.nonCore"))}
      sortGroupsBy={(a, b) => {
        const order = [language.t("command.skills.group.core"), language.t("command.skills.group.nonCore")]
        return order.indexOf(a.category) - order.indexOf(b.category)
      }}
      groupHeader={(group) => (
        <div class="flex items-center gap-2 px-2 py-1 text-12-medium text-text-weaker uppercase tracking-wider">
          <span>{group.category}</span>
          <span class="text-text-subtle">({group.items.length})</span>
        </div>
      )}
      onSelect={(item: SkillItem | undefined) => {
        if (!item) return
        if (!item.loaded) handleLoad(item.name)
      }}
      onMove={(item: SkillItem | undefined) => {
        const name = item?.name
        setHighlighted(name)
        fetchPreview(name)
      }}
    >
      {(item: SkillItem) => (
        <div class="w-full flex items-center justify-between gap-x-3">
          <div class="flex flex-col gap-0.5 min-w-0">
            <div class="flex items-center gap-2">
              <span class="truncate">{item.name}</span>
            </div>
            <Show when={item.description}>
              <span class="text-12-regular text-text-weaker truncate">{item.description}</span>
            </Show>
          </div>
          <Show when={item.loaded}>
            <Icon name="check" size="small" class="text-icon-success shrink-0" />
          </Show>
        </div>
      )}
    </List>
  )

  return (
    <Dialog title={language.t("command.skills.title")} size="large" transition>
      {wideLayout(listContent)}
    </Dialog>
  )
}
