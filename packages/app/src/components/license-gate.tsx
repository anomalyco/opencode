import { Splash } from "@opencode-ai/ui/logo"
import type { Component } from "solid-js"
import { Show } from "solid-js"
import { useLicense } from "@/context/license"
import { useLanguage } from "@/context/language"
import { LicensePanel } from "./license-panel"

export const LicenseGate: Component = () => {
  const license = useLicense()
  const language = useLanguage()

  return (
    <div class="min-h-screen w-full bg-background-base px-4 py-8 sm:px-8">
      <div class="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[560px] items-center justify-center">
        <div class="flex w-full flex-col gap-6 rounded-2xl border border-border-weak-base bg-surface-base p-6 shadow-xs-border-base sm:p-8">
          <div class="flex items-center gap-4">
            <Splash class="h-12 w-auto shrink-0" />
            <div class="flex flex-col gap-1">
              <span class="text-12-medium text-text-weak">{language.t("app.name.desktop")}</span>
              <span class="text-18-medium text-text-strong">{language.t("settings.tab.pricing")}</span>
            </div>
          </div>
          <Show when={!license.ready() && license.phase() === "checking"}>
            <div class="rounded-md bg-surface-raised-base px-3 py-2 text-12-regular text-text-weak">
              {language.t("settings.pricing.state.checking")}
            </div>
          </Show>
          <LicensePanel mode="gate" />
        </div>
      </div>
    </div>
  )
}
