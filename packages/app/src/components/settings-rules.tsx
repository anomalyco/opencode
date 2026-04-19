import { Component } from "solid-js"
import { EditorView } from "codemirror"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { formatServerError } from "@/utils/server-errors"
import { markdown } from "@codemirror/lang-markdown"
import { SettingsCodeEditor } from "./settings-code-editor"

export const SettingsRules: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()

  return (
    <SettingsCodeEditor
      title={language.t("settings.tab.rules")}
      extensions={[markdown(), EditorView.lineWrapping]}
      load={async () => {
        const result = await globalSDK.client.global.rulesFile.get()
        if (result.error) throw new Error(formatServerError(result.error))
        if (result.data) return { path: result.data.path, content: result.data.content }
      }}
      save={async (content) => {
        const result = await globalSDK.client.global.rulesFile.update({ content })
        if (result.error) throw new Error(formatServerError(result.error))
        if (result.data) return { content: result.data.content }
      }}
      i18n={{
        saved: language.t("settings.rules.saved"),
        savedDescription: language.t("settings.rules.saved.description"),
        saveFailed: language.t("settings.rules.error.saveFailed"),
        save: language.t("settings.rules.save"),
        revert: language.t("settings.rules.revert"),
        loading: language.t("settings.rules.loading"),
        loadFailed: language.t("settings.rules.loadFailed"),
        initFailed: language.t("settings.rules.initFailed"),
        unsaved: language.t("settings.rules.unsaved"),
      }}
    />
  )
}
