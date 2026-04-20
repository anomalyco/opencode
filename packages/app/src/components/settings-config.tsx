import { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { formatServerError } from "@/utils/server-errors"
import { json } from "@codemirror/lang-json"
import { linter, type Diagnostic } from "@codemirror/lint"
import { parse as parseJsonc, type ParseError as JsoncParseError, printParseErrorCode } from "jsonc-parser"
import { SettingsCodeEditor } from "./settings-code-editor"

function createJsonLinter(jsonc: boolean) {
  return linter((view) => {
    const errors: JsoncParseError[] = []
    parseJsonc(view.state.doc.toString(), errors, {
      allowTrailingComma: jsonc,
      disallowComments: !jsonc,
    })
    return errors.map(
      (e): Diagnostic => ({
        from: e.offset,
        to: e.offset + e.length,
        severity: "error",
        message: printParseErrorCode(e.error),
      }),
    )
  })
}

export const SettingsConfig: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()

  return (
    <SettingsCodeEditor
      title={language.t("settings.tab.config")}
      extensions={(path) => [json(), createJsonLinter(path.endsWith(".jsonc"))]}
      load={async () => {
        const result = await globalSDK.client.global.configFile.get()
        if (result.error) throw new Error(formatServerError(result.error))
        if (result.data) return { path: result.data.path, content: result.data.content }
      }}
      save={async (content) => {
        const result = await globalSDK.client.global.configFile.update({ content })
        if (result.error) throw new Error(formatServerError(result.error))
        if (result.data) return { content: result.data.content }
      }}
      i18n={{
        saved: language.t("settings.config.saved"),
        savedDescription: language.t("settings.config.saved.description"),
        saveFailed: language.t("settings.config.error.saveFailed"),
        save: language.t("settings.config.save"),
        revert: language.t("settings.config.revert"),
        loading: language.t("settings.config.loading"),
        loadFailed: language.t("settings.config.loadFailed"),
        initFailed: language.t("settings.config.initFailed"),
        unsaved: language.t("settings.config.unsaved"),
      }}
    />
  )
}
