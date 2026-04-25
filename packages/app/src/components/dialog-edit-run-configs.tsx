import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import { useMutation } from "@tanstack/solid-query"
import { Icon } from "@opencode-ai/ui/icon"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import type { LocalProject } from "@/context/layout"
import { useLanguage } from "@/context/language"
import { useTerminal } from "@/context/terminal"
import { loadProjectRunConfigs } from "@/pages/session/run-config"
import { useSessionLayout } from "@/pages/session/session-layout"

export function DialogEditRunConfigs(props: { project: LocalProject }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const language = useLanguage()
  const terminal = useTerminal()
  const { view } = useSessionLayout()
  const [store, setStore] = createStore({
    scanning: false,
    runConfigs:
      props.project.commands?.run?.map((config) => ({
        name: config.name,
        command: config.command,
        cwd: config.cwd,
      })) ?? [],
  })

  function runConfigs() {
    return store.runConfigs
      .map((config) => ({ name: config.name.trim(), command: config.command.trim(), cwd: config.cwd }))
      .filter((config) => config.command)
      .map((config) => ({ name: config.name || config.command, command: config.command, cwd: config.cwd }))
  }

  async function runConfig(input: { title: string; command: string; cwd?: string }) {
    if (terminal.running(input)) {
      await terminal.stop(input)
      return
    }

    const id = await terminal.run(input)
    if (!id) return
    view().terminal.open()
  }

  async function scanRunConfigs() {
    if (store.scanning) return
    setStore("scanning", true)
    const detected = await loadProjectRunConfigs(
      globalSDK.createClient({
        directory: props.project.worktree,
        throwOnError: true,
      }),
    ).finally(() => setStore("scanning", false))

    const existing = new Set(store.runConfigs.map((config) => `${config.name}\n${config.command}\n${config.cwd ?? ""}`))
    const next = detected
      .map((config) => ({ name: config.title, command: config.command, cwd: config.cwd }))
      .filter((config) => {
        const key = `${config.name}\n${config.command}\n${config.cwd ?? ""}`
        if (existing.has(key)) return false
        existing.add(key)
        return true
      })

    if (next.length === 0) return
    setStore("runConfigs", (configs) => [...configs, ...next])
  }

  const saveMutation = useMutation(() => ({
    mutationFn: async () => {
      const run = runConfigs()
      const start = props.project.commands?.start?.trim()
      const commands = { start, run }
      if (props.project.id && props.project.id !== "global") {
        const result = await globalSDK.client.project.update({
          projectID: props.project.id,
          directory: props.project.worktree,
          name: props.project.name ?? "",
          icon: {
            color: props.project.icon?.color || "",
            override: props.project.icon?.override || "",
            url: props.project.icon?.url || "",
          },
          commands,
        })
        const updated = result.data
        globalSync.project.meta(props.project.worktree, { commands })
        if (updated) {
          globalSync.set("project", (projects) =>
            projects.some((project) => project.id === updated.id)
              ? projects.map((project) =>
                  project.id === updated.id ? { ...project, ...updated, commands: { ...updated.commands, ...commands } } : project,
                )
              : [...projects, { ...updated, commands: { ...updated.commands, ...commands } }].sort((a, b) =>
                  a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
                ),
          )
        }
        dialog.close()
        return
      }

      globalSync.project.meta(props.project.worktree, {
        name: props.project.name,
        icon: {
          color: props.project.icon?.color,
          override: props.project.icon?.override,
        },
        commands,
      })
      dialog.close()
    },
  }))

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault()
    if (saveMutation.isPending) return
    saveMutation.mutate()
  }

  return (
    <Dialog title={language.t("dialog.project.edit.runConfigs")} class="w-full max-w-[560px] mx-auto">
      <form onSubmit={handleSubmit} class="flex min-h-0 flex-1 flex-col gap-6 p-6 pt-0">
        <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto no-scrollbar">
          <p class="text-13-regular text-text-weak">{language.t("dialog.project.edit.runConfigs.description")}</p>
          <Button
            type="button"
            variant="ghost"
            icon="magnifying-glass"
            class="self-start"
            disabled={store.scanning}
            onClick={() => void scanRunConfigs()}
          >
            {store.scanning
              ? language.t("dialog.project.edit.runConfigs.scan.scanning")
              : language.t("dialog.project.edit.runConfigs.scan")}
          </Button>
          <For each={store.runConfigs}>
            {(config, index) => (
              <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_auto_auto] gap-2 items-end">
                <TextField
                  type="text"
                  label={language.t("dialog.project.edit.runConfigs.name")}
                  placeholder={language.t("dialog.project.edit.runConfigs.name.placeholder")}
                  value={config.name}
                  onChange={(value) => setStore("runConfigs", index(), "name", value)}
                />
                <TextField
                  type="text"
                  label={language.t("dialog.project.edit.runConfigs.command")}
                  placeholder={language.t("dialog.project.edit.runConfigs.command.placeholder")}
                  value={config.command}
                  onChange={(value) => setStore("runConfigs", index(), "command", value)}
                  spellcheck={false}
                  class="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="ghost"
                  icon={terminal.running({ command: config.command.trim(), cwd: config.cwd }) ? "stop" : "play"}
                  disabled={!config.command.trim()}
                  onClick={() =>
                    void runConfig({
                      title: config.name.trim() || config.command.trim(),
                      command: config.command.trim(),
                      cwd: config.cwd,
                    })
                  }
                >
                  {language.t(
                    terminal.running({ command: config.command.trim(), cwd: config.cwd }) ? "run.stop" : "run.run",
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  icon="trash"
                  aria-label={language.t("dialog.project.edit.runConfigs.remove")}
                  onClick={() => setStore("runConfigs", (items) => items.filter((_, i) => i !== index()))}
                />
              </div>
            )}
          </For>
          <Button
            type="button"
            variant="ghost"
            icon="plus-small"
            class="self-start"
            onClick={() => setStore("runConfigs", store.runConfigs.length, { name: "", command: "", cwd: undefined })}
          >
            {language.t("dialog.project.edit.runConfigs.add")}
          </Button>
        </div>

        <div class="flex shrink-0 justify-end gap-2">
          <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button type="submit" variant="primary" size="large" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? language.t("common.saving") : language.t("common.save")}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
