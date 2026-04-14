import { Component } from "solid-js"

export const SettingsMcp: Component = () => {
  return (
    <div class="flex flex-col h-full overflow-y-auto">
      <div class="flex flex-col gap-6 p-6 max-w-[600px]">
        <h2 class="text-16-medium text-text-strong">MCP</h2>
        <p class="text-14-regular text-text-weak">MCP settings will be configurable here.</p>
      </div>
    </div>
  )
}
