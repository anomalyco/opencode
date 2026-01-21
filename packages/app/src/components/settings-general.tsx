import { Component, createMemo, type JSX } from "solid-js"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { useLanguage } from "@/context/language"
import { useSettings, monoFontFamily } from "@/context/settings"
import { playSound, SOUND_OPTIONS } from "@/utils/sound"

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const settings = useSettings()

  const themeOptions = createMemo(() =>
    Object.entries(theme.themes()).map(([id, def]) => ({ id, name: def.name ?? id })),
  )

  const colorSchemeOptions = createMemo((): { value: ColorScheme; label: string }[] => [
    { value: "system", label: language.t("theme.scheme.system") },
    { value: "light", label: language.t("theme.scheme.light") },
    { value: "dark", label: language.t("theme.scheme.dark") },
  ])

  const languageOptions = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )

  const fontOptions = [
    { value: "ibm-plex-mono", label: "font.option.ibmPlexMono" },
    { value: "cascadia-code", label: "font.option.cascadiaCode" },
    { value: "fira-code", label: "font.option.firaCode" },
    { value: "hack", label: "font.option.hack" },
    { value: "inconsolata", label: "font.option.inconsolata" },
    { value: "intel-one-mono", label: "font.option.intelOneMono" },
    { value: "jetbrains-mono", label: "font.option.jetbrainsMono" },
    { value: "meslo-lgs", label: "font.option.mesloLgs" },
    { value: "roboto-mono", label: "font.option.robotoMono" },
    { value: "source-code-pro", label: "font.option.sourceCodePro" },
    { value: "ubuntu-mono", label: "font.option.ubuntuMono" },
  ] as const
  const fontOptionsList = [...fontOptions]

  const soundOptions = [...SOUND_OPTIONS]

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
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.general")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        {/* Appearance Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.appearance")}</h3>

          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.general.row.language.title")}
              description={language.t("settings.general.row.language.description")}
            >
              <Select
                options={languageOptions()}
                current={languageOptions().find((o) => o.value === language.locale())}
                value={(o) => o.value}
                label={(o) => o.label}
                onSelect={(option) => option && language.setLocale(option.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.appearance.title")}
              description={language.t("settings.general.row.appearance.description")}
            >
              <Select
                options={colorSchemeOptions()}
                current={colorSchemeOptions().find((o) => o.value === theme.colorScheme())}
                value={(o) => o.value}
                label={(o) => o.label}
                onSelect={(option) => option && theme.setColorScheme(option.value)}
                onHighlight={(option) => {
                  if (!option) return
                  theme.previewColorScheme(option.value)
                  return () => theme.cancelPreview()
                }}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.theme.title")}
              description={
                <>
                  {language.t("settings.general.row.theme.description")}{" "}
                  <a href="#" class="text-text-interactive-base">
                    {language.t("common.learnMore")}
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
                triggerVariant="settings"
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.font.title")}
              description={language.t("settings.general.row.font.description")}
            >
              <Select
                options={fontOptionsList}
                current={fontOptionsList.find((o) => o.value === settings.appearance.font())}
                value={(o) => o.value}
                label={(o) => language.t(o.label)}
                onSelect={(option) => option && settings.appearance.setFont(option.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "font-family": monoFontFamily(settings.appearance.font()), "min-width": "180px" }}
              >
                {(option) => (
                  <span style={{ "font-family": monoFontFamily(option?.value) }}>
                    {option ? language.t(option.label) : ""}
                  </span>
                )}
              </Select>
            </SettingsRow>
          </div>
        </div>

        {/* System notifications Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.notifications")}</h3>

          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.general.notifications.agent.title")}
              description={language.t("settings.general.notifications.agent.description")}
            >
              <Switch
                checked={settings.notifications.agent()}
                onChange={(checked) => settings.notifications.setAgent(checked)}
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.permissions.title")}
              description={language.t("settings.general.notifications.permissions.description")}
            >
              <Switch
                checked={settings.notifications.permissions()}
                onChange={(checked) => settings.notifications.setPermissions(checked)}
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.errors.title")}
              description={language.t("settings.general.notifications.errors.description")}
            >
              <Switch
                checked={settings.notifications.errors()}
                onChange={(checked) => settings.notifications.setErrors(checked)}
              />
            </SettingsRow>
          </div>
        </div>

        {/* Sound effects Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.sounds")}</h3>

          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.general.sounds.agent.title")}
              description={language.t("settings.general.sounds.agent.description")}
            >
              <Select
                options={soundOptions}
                current={soundOptions.find((o) => o.id === settings.sounds.agent())}
                value={(o) => o.id}
                label={(o) => language.t(o.label)}
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
                triggerVariant="settings"
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.sounds.permissions.title")}
              description={language.t("settings.general.sounds.permissions.description")}
            >
              <Select
                options={soundOptions}
                current={soundOptions.find((o) => o.id === settings.sounds.permissions())}
                value={(o) => o.id}
                label={(o) => language.t(o.label)}
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
                triggerVariant="settings"
              />
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.sounds.errors.title")}
              description={language.t("settings.general.sounds.errors.description")}
            >
              <Select
                options={soundOptions}
                current={soundOptions.find((o) => o.id === settings.sounds.errors())}
                value={(o) => o.id}
                label={(o) => language.t(o.label)}
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
                triggerVariant="settings"
              />
            </SettingsRow>
          </div>
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
