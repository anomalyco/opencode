import { Component } from "solid-js"
import { useLanguage } from "@/context/language"

export const SettingsModels: Component = () => {
  const language = useLanguage()

  return (
    <div class="flex flex-col h-full overflow-y-auto">
      <div class="flex flex-col gap-6 p-6 max-w-[600px]">
        <h2 class="text-16-medium text-text-strong">{language.t("settings.models.title")}</h2>
        <p class="text-14-regular text-text-weak">{language.t("settings.models.description")}</p>
      </div>
    </div>
  )
}
