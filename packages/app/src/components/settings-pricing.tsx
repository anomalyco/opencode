import type { Component } from "solid-js"
import { LicensePanel } from "./license-panel"

export const SettingsPricing: Component = () => {
  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="flex flex-col gap-8 max-w-[720px] pt-6">
        <LicensePanel mode="settings" />
      </div>
    </div>
  )
}
