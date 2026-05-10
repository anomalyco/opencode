import { Switch } from "@opencode-ai/ui/switch"
import { createMemo, type Component } from "solid-js"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { SettingsList } from "./settings-list"

export const SettingsBrowser: Component = () => {
  const language = useLanguage()
  const globalSync = useGlobalSync()
  const enabled = createMemo(() => globalSync.data.config.browser?.integratedTools?.enabled ?? true)

  const setEnabled = (value: boolean) => {
    const browser = {
      ...globalSync.data.config.browser,
      integratedTools: {
        ...globalSync.data.config.browser?.integratedTools,
        enabled: value,
      },
    }
    globalSync.set("config", "browser", browser)
    void globalSync.updateConfig({ browser })
  }

  return (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.browser.section")}</h3>
      <SettingsList>
        <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <span class="text-14-medium text-text-strong">{language.t("settings.browser.integratedTools.title")}</span>
            <span class="text-12-regular text-text-weak">
              {language.t("settings.browser.integratedTools.description")}
            </span>
          </div>
          <div class="flex w-full justify-end sm:w-auto sm:shrink-0" data-action="settings-browser-integrated-tools">
            <Switch checked={enabled()} onChange={setEnabled}>
              {language.t("settings.browser.integratedTools.title")}
            </Switch>
          </div>
        </div>
      </SettingsList>
    </div>
  )
}
