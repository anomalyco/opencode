import { Component, createMemo, createSignal, Show, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme"
import { showToast } from "@opencode-ai/ui/toast"
import { ScrollFade } from "@opencode-ai/ui/scroll-fade"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSettings, monoFontFamily } from "@/context/settings"
import { useGlobalSDK } from "@/context/global-sdk"
import { playSound, SOUND_OPTIONS } from "@/utils/sound"
import { Link } from "./link"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const playDemoSound = (src: string) => {
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }

  clearTimeout(demoSoundState.timeout)

  demoSoundState.timeout = setTimeout(() => {
    demoSoundState.cleanup = playSound(src)
  }, 100)
}

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const globalSDK = useGlobalSDK()

  // YOLO state - wird später vom Server geladen
  const [yoloEnabled, setYoloEnabled] = createSignal(false)
  const [yoloPersisted, setYoloPersisted] = createSignal(false)

  // Lade YOLO status beim Öffnen - mit kleinem Delay für Stabilität
  const loadYoloStatus = () => {
    const doFetch = platform.fetch ?? fetch
    doFetch(`${globalSDK.url}/config/yolo`)
      .then((response) => {
        if (response.ok) return response.json()
        return null
      })
      .then((data) => {
        if (data) {
          setYoloEnabled(data.enabled === true)
          setYoloPersisted(data.persisted === true)
        }
      })
      .catch(() => {
        // Silently ignore errors
      })
  }

  // Initialer Load mit kleinem Delay
  setTimeout(loadYoloStatus, 100)

  const setYolo = (enabled: boolean, persist: boolean) => {
    const doFetch = platform.fetch ?? fetch
    doFetch(`${globalSDK.url}/config/yolo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled, persist }),
    })
      .then((response) => {
        if (response.ok) return response.json()
        return null
      })
      .then((data) => {
        if (data) {
          setYoloEnabled(data.enabled === true)
          setYoloPersisted(data.persisted === true)
        }
      })
      .catch((e) => console.error("Failed to set YOLO:", e))
  }

  const [store, setStore] = createStore({
    checking: false,
  })

  const check = () => {
    if (!platform.checkUpdate) return
    setStore("checking", true)

    void platform
      .checkUpdate()
      .then((result) => {
        if (!result.updateAvailable) {
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("settings.updates.toast.latest.title"),
            description: language.t("settings.updates.toast.latest.description", { version: platform.version ?? "" }),
          })
          return
        }

        const actions =
          platform.update && platform.restart
            ? [
                {
                  label: language.t("toast.update.action.installRestart"),
                  onClick: async () => {
                    await platform.update!()
                    await platform.restart!()
                  },
                },
                {
                  label: language.t("toast.update.action.notYet"),
                  onClick: "dismiss" as const,
                },
              ]
            : [
                {
                  label: language.t("toast.update.action.notYet"),
                  onClick: "dismiss" as const,
                },
              ]

        showToast({
          persistent: true,
          icon: "download",
          title: language.t("toast.update.title"),
          description: language.t("toast.update.description", { version: result.version ?? "" }),
          actions,
        })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        showToast({ title: language.t("common.requestFailed"), description: message })
      })
      .finally(() => setStore("checking", false))
  }

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
    { value: "iosevka", label: "font.option.iosevka" },
    { value: "jetbrains-mono", label: "font.option.jetbrainsMono" },
    { value: "meslo-lgs", label: "font.option.mesloLgs" },
    { value: "roboto-mono", label: "font.option.robotoMono" },
    { value: "source-code-pro", label: "font.option.sourceCodePro" },
    { value: "ubuntu-mono", label: "font.option.ubuntuMono" },
  ] as const
  const fontOptionsList = [...fontOptions]

  const soundOptions = [...SOUND_OPTIONS]

  return (
    <ScrollFade
      direction="vertical"
      fadeStartSize={0}
      fadeEndSize={16}
      class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10"
    >
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-raised-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
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
                data-action="settings-language"
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
                data-action="settings-color-scheme"
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
                  <Link href="https://opencode.ai/docs/themes/">{language.t("common.learnMore")}</Link>
                </>
              }
            >
              <Select
                data-action="settings-theme"
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
                data-action="settings-font"
                options={fontOptionsList}
                current={fontOptionsList.find((o) => o.value === settings.appearance.font())}
                value={(o) => o.value}
                label={(o) => language.t(o.label)}
                onSelect={(option) => option && settings.appearance.setFont(option.value)}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                triggerStyle={{ "font-family": monoFontFamily(settings.appearance.font()), "field-sizing": "content" }}
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
              <div data-action="settings-notifications-agent">
                <Switch
                  checked={settings.notifications.agent()}
                  onChange={(checked) => settings.notifications.setAgent(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.permissions.title")}
              description={language.t("settings.general.notifications.permissions.description")}
            >
              <div data-action="settings-notifications-permissions">
                <Switch
                  checked={settings.notifications.permissions()}
                  onChange={(checked) => settings.notifications.setPermissions(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.notifications.errors.title")}
              description={language.t("settings.general.notifications.errors.description")}
            >
              <div data-action="settings-notifications-errors">
                <Switch
                  checked={settings.notifications.errors()}
                  onChange={(checked) => settings.notifications.setErrors(checked)}
                />
              </div>
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
                data-action="settings-sounds-agent"
                options={soundOptions}
                current={soundOptions.find((o) => o.id === settings.sounds.agent())}
                value={(o) => o.id}
                label={(o) => language.t(o.label)}
                onHighlight={(option) => {
                  if (!option) return
                  playDemoSound(option.src)
                }}
                onSelect={(option) => {
                  if (!option) return
                  settings.sounds.setAgent(option.id)
                  playDemoSound(option.src)
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
                data-action="settings-sounds-permissions"
                options={soundOptions}
                current={soundOptions.find((o) => o.id === settings.sounds.permissions())}
                value={(o) => o.id}
                label={(o) => language.t(o.label)}
                onHighlight={(option) => {
                  if (!option) return
                  playDemoSound(option.src)
                }}
                onSelect={(option) => {
                  if (!option) return
                  settings.sounds.setPermissions(option.id)
                  playDemoSound(option.src)
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
                data-action="settings-sounds-errors"
                options={soundOptions}
                current={soundOptions.find((o) => o.id === settings.sounds.errors())}
                value={(o) => o.id}
                label={(o) => language.t(o.label)}
                onHighlight={(option) => {
                  if (!option) return
                  playDemoSound(option.src)
                }}
                onSelect={(option) => {
                  if (!option) return
                  settings.sounds.setErrors(option.id)
                  playDemoSound(option.src)
                }}
                variant="secondary"
                size="small"
                triggerVariant="settings"
              />
            </SettingsRow>
          </div>
        </div>

        {/* Updates Section */}
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.updates")}</h3>

          <div class="bg-surface-raised-base px-4 rounded-lg">
            <SettingsRow
              title={language.t("settings.updates.row.startup.title")}
              description={language.t("settings.updates.row.startup.description")}
            >
              <div data-action="settings-updates-startup">
                <Switch
                  checked={settings.updates.startup()}
                  disabled={!platform.checkUpdate}
                  onChange={(checked) => settings.updates.setStartup(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.general.row.releaseNotes.title")}
              description={language.t("settings.general.row.releaseNotes.description")}
            >
              <div data-action="settings-release-notes">
                <Switch
                  checked={settings.general.releaseNotes()}
                  onChange={(checked) => settings.general.setReleaseNotes(checked)}
                />
              </div>
            </SettingsRow>

            <SettingsRow
              title={language.t("settings.updates.row.check.title")}
              description={language.t("settings.updates.row.check.description")}
            >
              <Button
                size="small"
                variant="secondary"
                disabled={store.checking || !platform.checkUpdate}
                onClick={check}
              >
                {store.checking
                  ? language.t("settings.updates.action.checking")
                  : language.t("settings.updates.action.checkNow")}
              </Button>
            </SettingsRow>
          </div>
        </div>

        {/* YOLO Mode Section */}
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2 pb-2">
            <h3 class="text-14-medium text-text-strong">YOLO Mode</h3>
            <Show when={yoloEnabled()}>
              <span class="text-10-medium text-fill-danger-base bg-fill-danger-ghost px-1.5 py-0.5 rounded">
                ACTIVE
              </span>
            </Show>
          </div>

          <p class="text-12-regular text-text-muted pb-2">
            Skip ALL permission prompts. OpenCode will execute without asking for confirmation.
          </p>

          {/* Warning */}
          <div class="p-3 rounded-lg border border-fill-warning-base bg-fill-warning-ghost mb-3">
            <p class="text-12-regular text-text-base">
              <span class="text-12-medium">Warning:</span> This is dangerous. Only enable if you fully trust OpenCode's
              actions. Explicit deny rules in your config will still be respected.
            </p>
          </div>

          {/* This Session Only Card */}
          <div
            class="p-3 rounded-lg border-2 transition-all mb-2"
            classList={{
              "border-fill-danger-base bg-fill-danger-ghost": yoloEnabled() && !yoloPersisted(),
              "border-border-weak-base bg-fill-ghost-base": !(yoloEnabled() && !yoloPersisted()),
            }}
          >
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-2">
                  <span class="text-13-medium text-text-base">This Session Only</span>
                  <Show when={yoloEnabled() && !yoloPersisted()}>
                    <span class="text-10-medium text-fill-danger-base">ACTIVE</span>
                  </Show>
                </div>
                <span class="text-11-regular text-text-muted">Resets when you restart OpenCode</span>
              </div>
              <Show
                when={yoloEnabled() && !yoloPersisted()}
                fallback={
                  <button
                    type="button"
                    onClick={() => setYolo(true, false)}
                    class="px-3 py-1.5 rounded text-12-medium bg-fill-danger-base text-white hover:bg-fill-danger-strong transition-colors"
                  >
                    Enable
                  </button>
                }
              >
                <button
                  type="button"
                  onClick={() => setYolo(false, false)}
                  class="px-3 py-1.5 rounded border border-border-base text-12-medium text-text-base hover:bg-fill-ghost-base transition-colors"
                >
                  Disable
                </button>
              </Show>
            </div>
          </div>

          {/* Always Enabled Card */}
          <div
            class="p-3 rounded-lg border-2 transition-all mb-3"
            classList={{
              "border-fill-danger-base bg-fill-danger-ghost": yoloPersisted(),
              "border-border-weak-base bg-fill-ghost-base": !yoloPersisted(),
            }}
          >
            <div class="flex items-center justify-between">
              <div class="flex flex-col gap-0.5">
                <div class="flex items-center gap-2">
                  <span class="text-13-medium text-text-base">Always Enabled</span>
                  <Show when={yoloPersisted()}>
                    <span class="text-10-medium text-fill-danger-base">ACTIVE</span>
                    <span class="text-10-medium text-fill-success-base">Saved</span>
                  </Show>
                </div>
                <span class="text-11-regular text-text-muted">Persists across restarts (saved in config.json)</span>
              </div>
              <Show
                when={yoloPersisted()}
                fallback={
                  <button
                    type="button"
                    onClick={() => setYolo(true, true)}
                    class="px-3 py-1.5 rounded text-12-medium bg-fill-danger-base text-white hover:bg-fill-danger-strong transition-colors"
                  >
                    Save to Config
                  </button>
                }
              >
                <button
                  type="button"
                  onClick={() => setYolo(false, true)}
                  class="px-3 py-1.5 rounded border border-border-base text-12-medium text-text-base hover:bg-fill-ghost-base transition-colors"
                >
                  Remove from Config
                </button>
              </Show>
            </div>
          </div>

          {/* CLI Usage */}
          <div class="p-3 rounded-lg border border-border-weak-base bg-fill-ghost-base">
            <span class="text-12-medium text-text-base">CLI Usage</span>
            <div class="mt-2 flex flex-col gap-1">
              <div class="flex items-center gap-3">
                <code class="text-11-regular font-mono text-text-muted">opencode --yolo</code>
                <span class="text-11-regular text-text-weak">one session</span>
              </div>
              <div class="flex items-center gap-3">
                <code class="text-11-regular font-mono text-text-muted">OPENCODE_YOLO=true</code>
                <span class="text-11-regular text-text-weak">env var</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ScrollFade>
  )
}

interface SettingsRowProps {
  title: string
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center justify-between gap-4 py-3 border-b border-border-weak-base last:border-none">
      <div class="flex flex-col gap-0.5 min-w-0">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex-shrink-0">{props.children}</div>
    </div>
  )
}
