import { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { McpDashboard } from "@/components/task/McpDashboard"
import { Icon } from "@opencode-ai/ui/icon"

export const SettingsMcp: Component = () => {
  const language = useLanguage()

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar" style={{ padding: "0 40px 40px 40px" }}>
      <div
        class="sticky top-0 z-10"
        style={{
          background:
            "linear-gradient(to bottom, var(--surface-raised-stronger-non-alpha) calc(100% - 24px), transparent)",
        }}
      >
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <div class="flex items-center gap-2">
            <Icon name="mcp" size="normal" />
            <h2 class="text-16-medium text-text-strong">{language.t("settings.mcp.title")}</h2>
          </div>
          <p class="text-14-regular text-text-weak">{language.t("settings.mcp.description")}</p>
        </div>
      </div>

      <div class="flex flex-col">
        <McpDashboard />
      </div>
    </div>
  )
}
