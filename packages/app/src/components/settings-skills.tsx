import { Component } from "solid-js"
import { useLanguage } from "@/context/language"
import { SkillsPanel } from "@/components/task/SkillsPanel"

export const SettingsSkills: Component = () => {
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
          <h2 class="text-16-medium text-text-strong">Skills</h2>
          <p class="text-14-regular text-text-weak">
            Manage and invoke available skills for AI assistants.
          </p>
        </div>
      </div>

      <div class="flex flex-col">
        <SkillsPanel />
      </div>
    </div>
  )
}
