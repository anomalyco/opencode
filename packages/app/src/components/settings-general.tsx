import { Component, createMemo, type JSX } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { useSettings } from "@/context/settings"
import { playSound, SOUND_OPTIONS } from "@/utils/sound"

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const settings = useSettings()

  const themeOptions = createMemo(() =>
    Object.entries(theme.themes()).map(([id, def]) => ({ id, name: def.name ?? id })),
  )

  const colorSchemeOptions: { value: ColorScheme; label: string }[] = [
    { value: "system", label: "System setting" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ]

  const fontOptions = [
    { value: "ibm-plex-mono", label: "IBM Plex Mono" },
    { value: "cascadia-code", label: "Cascadia Code" },
    { value: "fira-code", label: "Fira Code" },
    { value: "hack", label: "Hack" },
    { value: "inconsolata", label: "Inconsolata" },
    { value: "intel-one-mono", label: "Intel One Mono" },
    { value: "jetbrains-mono", label: "JetBrains Mono" },
    { value: "meslo-lgs", label: "Meslo LGS" },
    { value: "roboto-mono", label: "Roboto Mono" },
    { value: "source-code-pro", label: "Source Code Pro" },
    { value: "ubuntu-mono", label: "Ubuntu Mono" },
  ]

  const soundOptions = [...SOUND_OPTIONS]

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar">
      <div class="sticky top-0 z-10 bg-background-base border-b border-border-weak-base">
        <div class="flex flex-col gap-1 p-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">General</h2>
          <p class="text-14-regular text-text-weak">Appearance, notifications, and sound preferences.</p>
        </div>
      </div>

      <div class="flex flex-col gap-8 p-8 pt-6 max-w-[720px]">
        {/* Appearance Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Appearance</h3>

          <SettingsRow title="Appearance" description="Customise how OpenCode looks on your device">
            <Select
              options={colorSchemeOptions}
              current={colorSchemeOptions.find((o) => o.value === theme.colorScheme())}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(option) => option && theme.setColorScheme(option.value)}
              variant="secondary"
              size="small"
            />
          </SettingsRow>

          <SettingsRow
            title="Theme"
            description={
              <>
                Customise how OpenCode is themed.{" "}
                <a href="#" class="text-text-interactive-base">
                  Learn more
                </a>
              </>
            }
          >
            <Select
              options={themeOptions()}
              current={themeOptions().find((o) => o.id === theme.themeId())}
              value={(o) => o.id}
              label={(o) => o.name}
              onSelect={(option) => {
                if (!option) return
                theme.setTheme(option.id)
              }}
              onHighlight={(option) => {
                if (!option) return
                theme.previewTheme(option.id)
                return () => theme.cancelPreview()
              }}
              variant="secondary"
              size="small"
            />
          </SettingsRow>

          <SettingsRow title="Font" description="Customise the mono font used in code blocks">
            <Select
              options={fontOptions}
              current={fontOptions.find((o) => o.value === settings.appearance.font())}
              value={(o) => o.value}
              label={(o) => o.label}
              onSelect={(option) => option && settings.appearance.setFont(option.value)}
              variant="secondary"
              size="small"
            />
          </SettingsRow>
        </div>

        {/* System notifications Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">System notifications</h3>

          <SettingsRow
            title="Agent"
            description="Show system notification when the agent is complete or needs attention"
          >
            <Switch
              checked={settings.notifications.agent()}
              onChange={(checked) => settings.notifications.setAgent(checked)}
            />
          </SettingsRow>

          <SettingsRow title="Permissions" description="Show system notification when a permission is required">
            <Switch
              checked={settings.notifications.permissions()}
              onChange={(checked) => settings.notifications.setPermissions(checked)}
            />
          </SettingsRow>

          <SettingsRow title="Errors" description="Show system notification when an error occurs">
            <Switch
              checked={settings.notifications.errors()}
              onChange={(checked) => settings.notifications.setErrors(checked)}
            />
          </SettingsRow>
        </div>

        {/* Sound effects Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">Sound effects</h3>

          <SettingsRow title="Agent" description="Play sound when the agent is complete or needs attention">
            <Select
              options={soundOptions}
              current={soundOptions.find((o) => o.id === settings.sounds.agent())}
              value={(o) => o.id}
              label={(o) => o.label}
              onHighlight={(option) => {
                if (!option) return
                playSound(option.src)
              }}
              onSelect={(option) => {
                if (!option) return
                settings.sounds.setAgent(option.id)
                playSound(option.src)
              }}
              variant="secondary"
              size="small"
            />
          </SettingsRow>

          <SettingsRow title="Permissions" description="Play sound when a permission is required">
            <Select
              options={soundOptions}
              current={soundOptions.find((o) => o.id === settings.sounds.permissions())}
              value={(o) => o.id}
              label={(o) => o.label}
              onHighlight={(option) => {
                if (!option) return
                playSound(option.src)
              }}
              onSelect={(option) => {
                if (!option) return
                settings.sounds.setPermissions(option.id)
                playSound(option.src)
              }}
              variant="secondary"
              size="small"
            />
          </SettingsRow>

          <SettingsRow title="Errors" description="Play sound when an error occurs">
            <Select
              options={soundOptions}
              current={soundOptions.find((o) => o.id === settings.sounds.errors())}
              value={(o) => o.id}
              label={(o) => o.label}
              onHighlight={(option) => {
                if (!option) return
                playSound(option.src)
              }}
              onSelect={(option) => {
                if (!option) return
                settings.sounds.setErrors(option.id)
                playSound(option.src)
              }}
              variant="secondary"
              size="small"
            />
          </SettingsRow>
        </div>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
