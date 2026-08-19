import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/switch"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { For, Show, createResource, type Component } from "solid-js"
import { usePlatform, type DesktopMod } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import { DialogModConflictV2 } from "./dialog-mod-conflict-v2"

export const SettingsModsV2: Component = () => {
  const platform = usePlatform()
  const dialog = useDialog()
  const language = useLanguage()
  const [mods, { refetch }] = createResource(() => platform.mods?.list(), { initialValue: [] as DesktopMod[] })
  const [safeMode, { refetch: refetchSafeMode }] = createResource(() => platform.mods?.safeMode(), { initialValue: false })

  const applyChange = (mod: DesktopMod) => {
    if (mod.contributes?.server || mod.contributes?.database) {
      void platform.restart()
      return
    }
    if (mod.contributes?.host) {
      window.location.reload()
      return
    }
    void refetch()
  }

  const refresh = () => {
    void platform.mods?.reload().then((loaded) => {
      if (loaded.some((mod) => mod.enabled && mod.compatible && (mod.contributes?.server || mod.contributes?.database))) {
        void platform.restart()
        return
      }
      if (loaded.some((mod) => mod.enabled && mod.compatible && mod.contributes?.host)) {
        window.location.reload()
        return
      }
      void refetch()
    })
  }

  const enable = async (mod: DesktopMod) => {
    const report = await platform.mods?.preload(mod.id)
    if (!report) return
    if (report.conflicts.length) {
      void dialog.show(() => (
        <DialogModConflictV2
          mod={report.mod}
          directory={report.directory}
          conflicts={report.conflicts}
          onResolve={async (resolution) => {
            const loaded = await platform.mods!.setEnabled(mod.id, true, resolution)
            const resolved = loaded.find((item) => item.id === mod.id) ?? mod
            applyChange(resolved)
          }}
        />
      ))
      return
    }
    const loaded = await platform.mods.setEnabled(mod.id, true)
    applyChange(loaded.find((item) => item.id === mod.id) ?? mod)
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <div class="settings-v2-tab-header-row">
          <h2 class="settings-v2-tab-title">{language.t("settings.mods.title")}</h2>
          <div class="flex gap-2">
            <ButtonV2 size="small" variant="neutral" onClick={() => void platform.mods?.openFolder()}>
              {language.t("settings.mods.openFolder")}
            </ButtonV2>
            <ButtonV2 size="small" variant="neutral" onClick={refresh}>
              {language.t("settings.mods.refresh")}
            </ButtonV2>
          </div>
        </div>
      </div>

      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("settings.mods.safeMode.title")}
              description={language.t("settings.mods.safeMode.description")}
            >
              <Switch
                checked={!safeMode.latest}
                onChange={(enabled) => {
                  void platform.mods?.setSafeMode(!enabled).then((loaded) => {
                    void refetchSafeMode()
                    if (
                      loaded.some(
                        (mod) => mod.enabled && mod.compatible && (mod.contributes?.server || mod.contributes?.database),
                      )
                    ) {
                      void platform.restart()
                      return
                    }
                    window.location.reload()
                  })
                }}
              />
            </SettingsRowV2>
          </SettingsListV2>
        </div>

        <Show
          when={mods.latest.length}
          fallback={<div class="settings-v2-servers-status">{language.t("settings.mods.empty")}</div>}
        >
          <div class="settings-v2-section">
            <SettingsListV2>
              <For each={mods.latest}>
                {(mod) => (
                  <SettingsRowV2
                    title={mod.name}
                    description={
                      mod.error ??
                      (mod.compatible
                        ? language.t("settings.mods.versionPriority", { version: mod.version, priority: mod.priority })
                        : language.t("settings.mods.versionIncompatible", { version: mod.version }))
                    }
                  >
                    <div class="flex items-center gap-2">
                      <ButtonV2
                        size="small"
                        variant="ghost-muted"
                        disabled={Boolean(mod.error) || mod.priority <= -1000}
                        onClick={() => {
                          void platform.mods?.setPriority(mod.id, mod.priority - 1).then(() => applyChange(mod))
                        }}
                      >
                        -
                      </ButtonV2>
                      <ButtonV2
                        size="small"
                        variant="ghost-muted"
                        disabled={Boolean(mod.error) || mod.priority >= 1000}
                        onClick={() => {
                          void platform.mods?.setPriority(mod.id, mod.priority + 1).then(() => applyChange(mod))
                        }}
                      >
                        +
                      </ButtonV2>
                      <Switch
                        checked={mod.enabled}
                        disabled={!mod.compatible}
                        onChange={(enabled) => {
                          if (enabled) {
                            void enable(mod)
                            return
                          }
                          void platform.mods?.setEnabled(mod.id, false).then(() => applyChange(mod))
                        }}
                      />
                    </div>
                  </SettingsRowV2>
                )}
              </For>
            </SettingsListV2>
          </div>
        </Show>
      </div>
    </>
  )
}
