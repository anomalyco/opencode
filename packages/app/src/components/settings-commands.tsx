import { showToast } from "@opencode-ai/ui/toast"
import { Button } from "@opencode-ai/ui/button"
import { getFilename } from "@opencode-ai/util/path"
import { Component, For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"

function clean(input: string) {
  const quoted = (input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'"))
  if (!quoted) return input
  return input.slice(1, -1)
}

function parse(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { template: markdown.trim() }

  const meta = {
    description: undefined as string | undefined,
    agent: undefined as string | undefined,
    model: undefined as string | undefined,
    subtask: undefined as boolean | undefined,
  }

  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\s*([a-z_]+)\s*:\s*(.*?)\s*$/)
    if (!item) continue
    const key = item[1]
    const val = clean(item[2])
    if (key === "description") meta.description = val
    if (key === "agent") meta.agent = val
    if (key === "model") meta.model = val
    if (key === "subtask") meta.subtask = val === "true"
  }

  return {
    ...meta,
    template: match[2].trim(),
  }
}

function name(path: string) {
  const file = getFilename(path).replace(/\.md$/i, "").trim()
  return file.replace(/\s+/g, "-")
}

export const SettingsCommands: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const [store, setStore] = createStore({ loading: false })
  const files = createMemo(() => Boolean(platform.openFilePickerDialog && platform.readTextFile))
  const dirs = createMemo(() => Boolean(platform.openDirectoryPickerDialog && platform.readMarkdownFiles))

  const list = createMemo(() => {
    return Object.keys(globalSync.data.config.command ?? {}).sort((a, b) => a.localeCompare(b))
  })

  const apply = async (input: Array<{ path: string; text: string }>) => {
    const next: Record<
      string,
      { template: string; description?: string; agent?: string; model?: string; subtask?: boolean }
    > = {}
    for (const item of input) {
      const key = name(item.path)
      if (!key) continue
      const parsed = parse(item.text)
      if (!parsed.template) continue
      next[key] = parsed
    }
    if (Object.keys(next).length === 0) {
      showToast({ title: language.t("common.requestFailed"), description: "No valid commands were imported." })
      return
    }
    const curr = globalSync.data.config.command ?? {}
    await globalSync.updateConfig({ command: { ...curr, ...next } })
    showToast({
      variant: "success",
      icon: "circle-check",
      title: "Commands imported",
      description: `${Object.keys(next).length} command${Object.keys(next).length > 1 ? "s" : ""} saved in global config.`,
    })
  }

  const file = async () => {
    if (!files()) return
    const pick = await platform.openFilePickerDialog!({ multiple: true, title: "Choose command markdown files" })
    if (!pick) return
    const paths = (Array.isArray(pick) ? pick : [pick]).filter((item) => item.toLowerCase().endsWith(".md"))
    if (paths.length === 0) {
      showToast({ title: language.t("common.requestFailed"), description: "Pick one or more .md files." })
      return
    }
    setStore("loading", true)
    try {
      await apply(await Promise.all(paths.map(async (path) => ({ path, text: await platform.readTextFile!(path) }))))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: msg })
    } finally {
      setStore("loading", false)
    }
  }

  const dir = async () => {
    if (!dirs()) return
    const pick = await platform.openDirectoryPickerDialog!({
      multiple: true,
      title: "Choose folders with command files",
    })
    if (!pick) return
    const paths = Array.isArray(pick) ? pick : [pick]
    setStore("loading", true)
    try {
      await apply(await platform.readMarkdownFiles!(paths))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: msg })
    } finally {
      setStore("loading", false)
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-3 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.commands.title")}</h2>
          <p class="text-14-regular text-text-weak">{language.t("settings.commands.description")}</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px]">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Global command files</h3>
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <div class="flex items-center justify-between gap-4 min-h-16 py-3 border-b border-border-weak-base">
              <div class="text-14-regular text-text-weak">
                Import `.md` files or folders and use them as slash commands in every project.
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <div onClick={() => (store.loading || !files() ? undefined : void file())}>
                  <Button
                    size="large"
                    variant="secondary"
                    class={store.loading || !files() ? "opacity-50 pointer-events-none" : undefined}
                  >
                    {store.loading
                      ? `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`
                      : "Import files"}
                  </Button>
                </div>
                <div onClick={() => (store.loading || !dirs() ? undefined : void dir())}>
                  <Button
                    size="large"
                    variant="secondary"
                    class={store.loading || !dirs() ? "opacity-50 pointer-events-none" : undefined}
                  >
                    {store.loading
                      ? `${language.t("common.loading")}${language.t("common.loading.ellipsis")}`
                      : "Import folders"}
                  </Button>
                </div>
              </div>
            </div>

            <Show
              when={list().length > 0}
              fallback={<div class="py-4 text-14-regular text-text-weak">No global commands configured yet.</div>}
            >
              <For each={list()}>
                {(item) => (
                  <div class="min-h-12 py-3 border-b border-border-weak-base last:border-none">
                    <div class="text-14-medium text-text-strong">/{item}</div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>

        <div class="text-12-regular text-text-weak max-w-[640px]">
          Imported commands are stored in your global OpenCode config and shared across all projects.
        </div>
      </div>

      <Show when={!files() && !dirs()}>
        <div class="max-w-[720px] text-12-regular text-text-weak mt-6">
          Command import is available in the desktop app.
        </div>
      </Show>
    </div>
  )
}
