import { Component, createSignal, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useGlobalSync } from "@/context/global-sync"
import { useGlobalSDK } from "@/context/global-sdk"

export const SettingsConfig: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const globalSync = useGlobalSync()
  const globalSDK = useGlobalSDK()

  const [selectedPath, setSelectedPath] = createSignal<string | null>(null)
  const [configContent, setConfigContent] = createSignal("")
  const [loading, setLoading] = createSignal(false)
  const [editorOpen, setEditorOpen] = createSignal(false)

  const globalPath = () => globalSync.data.path.config

  const projectPath = () => {
    const worktree = globalSync.data.path.worktree
    if (!worktree) return null
    return `${worktree}/opencode.json`
  }

  const findProjectConfig = async (worktree: string): Promise<{ path: string; content: string } | null> => {
    if (!platform.readConfigFile) return null
    for (const ext of [".json", ".jsonc"]) {
      const p = `${worktree}/opencode${ext}`
      try {
        const content = await platform.readConfigFile(p)
        return { path: p, content }
      } catch {
        continue
      }
    }
    return null
  }

  const openGlobalEditor = () => {
    const config = globalSync.data.config
    const json = JSON.stringify(config, null, 2)
    setConfigContent(json)
    setSelectedPath(globalPath())
    setEditorOpen(true)
  }

  const openProjectEditor = async () => {
    const worktree = globalSync.data.path.worktree
    if (!worktree || platform.platform !== "desktop" || !platform.readConfigFile) return

    setLoading(true)
    try {
      const found = await findProjectConfig(worktree)
      if (found) {
        setConfigContent(found.content)
        setSelectedPath(found.path)
      } else {
        const defaultConfig = `{
  "$schema": "https://opencode.ai/config.json",
  "providers": {},
  "agent": {},
  "mode": {}
}`
        setConfigContent(defaultConfig)
        setSelectedPath(projectPath()!)
      }
      setEditorOpen(true)
    } finally {
      setLoading(false)
    }
  }

  const saveConfig = async () => {
    const path = selectedPath()
    if (!path) return

    const isGlobal = path === globalPath()

    if (isGlobal) {
      try {
        const config = JSON.parse(configContent())
        await globalSDK.client.global.config.update({ config })
        showToast({
          variant: "success",
          title: language.t("common.success"),
          description: "Global config saved. Restarting...",
        })
        setEditorOpen(false)
        if (platform.restart) {
          setTimeout(() => platform.restart(), 500)
        }
      } catch (e) {
        showToast({
          variant: "error",
          title: language.t("common.error"),
          description: `Invalid JSON: ${String(e)}`,
        })
      }
    } else {
      if (platform.platform !== "desktop" || !platform.writeConfigFile) return

      setLoading(true)
      try {
        await platform.writeConfigFile(path, configContent())
        showToast({
          variant: "success",
          title: language.t("common.success"),
          description: "Project config saved. Restarting...",
        })
        setEditorOpen(false)
        if (platform.restart) {
          setTimeout(() => platform.restart(), 500)
        }
      } catch (e) {
        const errMsg = String(e)
        if (errMsg.includes("Access is denied")) {
          showToast({
            variant: "error",
            title: language.t("common.error"),
            description: "Access denied. Check file permissions.",
          })
        } else {
          showToast({
            variant: "error",
            title: language.t("common.error"),
            description: String(e),
          })
        }
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.config.title")}</h2>
        </div>
      </div>

      <Show when={!editorOpen()}>
        <div class="flex flex-col gap-4 w-full">
          <div class="bg-surface-raised-base px-4 rounded-lg">
            <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base">
              <div class="flex flex-col gap-0.5 min-w-0">
                <span class="text-14-medium text-text-strong">{language.t("settings.config.project.title")}</span>
                <span class="text-12-regular text-text-weak">{language.t("settings.config.project.description")}</span>
                <Show when={projectPath()}>
                  <span class="text-11-regular text-text-weak font-mono mt-1">{projectPath()}</span>
                </Show>
              </div>
              <div class="flex-shrink-0">
                <Button size="small" variant="secondary" disabled={loading()} onClick={openProjectEditor}>
                  {projectPath() ? language.t("common.edit") : language.t("common.create")}
                </Button>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-4 py-3">
              <div class="flex flex-col gap-0.5 min-w-0">
                <span class="text-14-medium text-text-strong">{language.t("settings.config.global.title")}</span>
                <span class="text-12-regular text-text-weak">{language.t("settings.config.global.description")}</span>
                <span class="text-11-regular text-text-weak font-mono mt-1">{globalPath()}</span>
              </div>
              <div class="flex-shrink-0">
                <Button size="small" variant="secondary" disabled={loading()} onClick={openGlobalEditor}>
                  {language.t("common.edit")}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      <Show when={editorOpen()}>
        <div class="flex flex-col gap-4 w-full h-full">
          <div class="flex items-center justify-between">
            <span class="text-14-medium text-text-strong">{selectedPath()}</span>
            <div class="flex gap-2">
              <Button size="small" variant="secondary" onClick={() => setEditorOpen(false)}>
                {language.t("common.cancel")}
              </Button>
              <Button size="small" variant="primary" disabled={loading()} onClick={saveConfig}>
                {language.t("common.save")}
              </Button>
            </div>
          </div>
          <textarea
            class="flex-1 min-h-[400px] w-full bg-surface-raised-base text-text-strong font-mono text-12-regular p-4 rounded-lg border border-border-weak-base focus:outline-none focus:border-border-strong-base resize-none"
            value={configContent()}
            onInput={(e) => setConfigContent(e.currentTarget.value)}
            spellcheck={false}
          />
        </div>
      </Show>
    </div>
  )
}
