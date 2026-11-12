import { Component, Show, createEffect, createMemo, createResource, createSignal, onCleanup } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Select } from "@opencode/ui/select"
import { Switch } from "@opencode/ui/switch"
import { Button } from "@opencode/ui/button"
import { TimelineDetailControl } from "@/settings/timeline-detail"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import type { ShareStatus } from "@/runtime/platform/platform"
import { PluginSettingsSections } from "@/runtime/plugin/settings-page-view"
import {
  type BackgroundActivity,
  type FollowUpBehavior,
  type TimelineWidth,
  type WorkspaceDefaultDestination,
  useSettings,
} from "@/settings/model"
import { formatKeybind } from "@/shell/commands/command"
import { SettingsList } from "@/settings/list"
import { SettingsRow } from "@/settings/row"
import { createShellOptions } from "./behavior"
import { createOptimisticSetting, type ShellSettingsController } from "./controllers"
import { InterfaceModeSetting } from "./interface-mode"
import "@/settings/settings.css"

const AutoApprovePermissionsSetting: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  return (
    <SettingsRow
      title={language.t("command.permissions.autoaccept.enable")}
      description={language.t("settings.permissions.autoAccept.default.description")}
    >
      <div data-action="settings-auto-accept-permissions">
        <Switch
          checked={settings.permissions.autoApproveDefault()}
          onChange={(checked) => settings.permissions.setAutoApproveDefault(checked)}
        />
      </div>
    </SettingsRow>
  )
}

const WorkspaceDestinationSetting: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  const options = createMemo((): { value: WorkspaceDefaultDestination; label: string }[] => [
    { value: "last-used", label: language.t("settings.workspaces.default.lastUsed") },
    { value: "local", label: language.t("settings.workspaces.default.local") },
    { value: "new", label: language.t("settings.workspaces.default.new") },
  ])

  return (
    <SettingsRow
      title={language.t("settings.workspaces.default.title")}
      description={language.t("settings.workspaces.default.description")}
    >
      <Select
        data-action="settings-workspace-destination"
        options={options()}
        current={options().find((option) => option.value === settings.workspaces.defaultDestination())}
        value={(option) => option.value}
        label={(option) => option.label}
        placement="bottom-end"
        gutter={6}
        onSelect={(option) => option && settings.workspaces.setDefaultDestination(option.value)}
      />
    </SettingsRow>
  )
}

export const ShellSetting: Component<{
  controller: ShellSettingsController
  /** Search reveals the row with the default action; the Servers page names the other servers' rows apart. */
  action?: string
}> = (props) => {
  const language = useLanguage()

  const options = createMemo(() =>
    createShellOptions({
      shells: props.controller.shells(),
      current: props.controller.current(),
    }),
  )

  return (
    <SettingsRow
      title={language.t("settings.general.row.shell.title")}
      description={language.t("settings.general.row.shell.description")}
    >
      <Select
        data-action={props.action ?? "settings-shell"}
        options={options()}
        current={options().find((option) => option.value === props.controller.current()) ?? options()[0]}
        placement="bottom-end"
        gutter={6}
        value={(option) => option.id}
        label={(option) => {
          if (option.id === "auto") return language.t("settings.general.row.shell.autoDefault")

          if (!option.terminalOnly) return option.name

          return `${option.name} (${language.t("settings.general.row.shell.terminalOnly")})`
        }}
        onSelect={(option) => option && props.controller.select(option.value)}
      />
    </SettingsRow>
  )
}

const FollowUpBehaviorSetting: Component = () => {
  const language = useLanguage()
  const settings = useSettings()

  const options = createMemo((): { value: FollowUpBehavior; label: string }[] => [
    { value: "queue", label: language.t("settings.general.row.followUpBehavior.queue") },
    { value: "steer", label: language.t("settings.general.row.followUpBehavior.steer") },
  ])

  return (
    <SettingsRow
      title={language.t("settings.general.row.followUpBehavior.title")}
      description={language.t("settings.general.row.followUpBehavior.description", {
        keybind: formatKeybind("mod+enter", language.t),
      })}
    >
      <Select
        data-action="settings-follow-up-behavior"
        options={options()}
        current={options().find((option) => option.value === settings.general.followUpBehavior())}
        value={(option) => option.value}
        label={(option) => option.label}
        placement="bottom-end"
        gutter={6}
        onSelect={(option) => option && settings.general.setFollowUpBehavior(option.value)}
      />
    </SettingsRow>
  )
}

const BackgroundActivitySetting = () => {
  const language = useLanguage()
  const settings = useSettings()

  const options = createMemo((): { value: BackgroundActivity; label: string }[] => [
    { value: "off", label: language.t("settings.timeline.row.backgroundActivity.off") },
    { value: "left", label: language.t("settings.timeline.row.backgroundActivity.left") },
    { value: "center", label: language.t("settings.timeline.row.backgroundActivity.center") },
    { value: "right", label: language.t("settings.timeline.row.backgroundActivity.right") },
  ])

  return (
    <SettingsRow
      title={language.t("settings.timeline.row.backgroundActivity.title")}
      description={language.t("settings.timeline.row.backgroundActivity.description")}
    >
      <Select
        data-action="settings-background-activity"
        aria-label={language.t("settings.timeline.row.backgroundActivity.title")}
        options={options()}
        current={options().find((option) => option.value === settings.general.backgroundActivity())}
        value={(option) => option.value}
        label={(option) => option.label}
        placement="bottom-end"
        gutter={6}
        onSelect={(option) => option && settings.general.setBackgroundActivity(option.value)}
      />
    </SettingsRow>
  )
}

const TimelineWidthSetting = () => {
  const language = useLanguage()
  const settings = useSettings()

  const options = createMemo((): { value: TimelineWidth; label: string }[] => [
    { value: "focused", label: language.t("settings.timeline.row.width.focused") },
    { value: "comfortable", label: language.t("settings.timeline.row.width.comfortable") },
    { value: "wide", label: language.t("settings.timeline.row.width.wide") },
  ])

  return (
    <SettingsRow
      title={language.t("settings.timeline.row.width.title")}
      description={language.t("settings.timeline.row.width.description")}
    >
      <Select
        data-action="settings-timeline-width"
        aria-label={language.t("settings.timeline.row.width.title")}
        options={options()}
        current={options().find((option) => option.value === settings.general.timelineWidth())}
        value={(option) => option.value}
        label={(option) => option.label}
        placement="bottom-end"
        gutter={6}
        onSelect={(option) => option && settings.general.setTimelineWidth(option.value)}
      />
    </SettingsRow>
  )
}

const LanguageSetting = () => {
  const language = useLanguage()

  const options = createMemo(() =>
    language.locales.map((locale) => ({
      value: locale,
      label: language.label(locale),
    })),
  )

  return (
    <SettingsRow
      title={language.t("settings.general.row.language.title")}
      description={language.t("settings.general.row.language.description")}
    >
      <Select
        data-action="settings-language"
        options={options()}
        placement="bottom-end"
        gutter={6}
        current={options().find((option) => option.value === language.locale())}
        value={(option) => option.value}
        label={(option) => option.label}
        onSelect={(option) => option && language.setLocale(option.value)}
      />
    </SettingsRow>
  )
}

const SHARE_STATE_KEYS = {
  disabled: "settings.general.row.deviceSharing.state.disabled",
  connecting: "settings.general.row.deviceSharing.state.connecting",
  online: "settings.general.row.deviceSharing.state.online",
  error: "settings.general.row.deviceSharing.state.error",
} as const

const DeviceSharingSetting: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()

  const [status, { mutate: setStatus }] = createResource(
    () => "getShareStatus" in platform,
    () => platform.getShareStatus?.().catch(() => ({ enabled: false, state: "error" } satisfies ShareStatus)),
    { initialValue: { enabled: false, state: "disabled" } satisfies ShareStatus },
  )

  const [account] = createResource(
    () => "getShareAccount" in platform,
    () => platform.getShareAccount?.().catch(() => null) ?? null,
    { initialValue: null },
  )

  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal("")

  const current = (): ShareStatus => status.latest ?? { enabled: false, state: "disabled" }
  const hasAccount = () => account.latest !== null && account.latest !== undefined

  // The main process reports failures with a marker for known cases so the
  // message can be localized instead of showing a raw backend string.
  const shareErrorText = (value?: string) => {
    if (!value) return ""

    if (value === "invalid_credentials") {
      return language.t("settings.general.row.deviceSharing.error.invalidCredentials")
    }

    return value
  }

  // The main process establishes the tunnel asynchronously. Poll while the
  // state is transitional so the UI reflects "online" or "error" as soon as it
  // settles instead of staying stuck on "connecting".
  createEffect(() => {
    if (status.latest?.state !== "connecting") return

    const timer = setInterval(() => {
      void platform.getShareStatus?.().then((value) => {
        if (!value) return
        setStatus(value)

        if (value.state !== "connecting") clearInterval(timer)
      })
    }, 1500)

    onCleanup(() => clearInterval(timer))
  })

  // The relay reports the failure reason on the status, not as a rejection.
  createEffect(() => {
    const message = shareErrorText(current().error)

    if (message) setError(message)
  })

  const applyToggle = (checked: boolean) => {
    setBusy(true)
    setError("")
    const update = checked ? platform.enableShare?.() : platform.disableShare?.()

    if (!update) {
      setBusy(false)

      return
    }

    void update.then(setStatus).catch((err) => {
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => setBusy(false))
  }

  const stateLabel = () => language.t(SHARE_STATE_KEYS[current().state])

  return (
    <div class="flex flex-col gap-3">
      <SettingsRow
        title={language.t("settings.general.row.deviceSharing.title")}
        description={language.t("settings.general.row.deviceSharing.description")}
      >
        <div data-action="settings-device-sharing">
          <Switch
            checked={current().enabled}
            disabled={!hasAccount() || busy()}
            onChange={(checked) => applyToggle(checked)}
          />
        </div>
      </SettingsRow>

      <Show when={hasAccount()}>
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2 text-xs text-v2-text-text-muted">
            <span
              classList={{
                "size-1.5 shrink-0 rounded-full": true,
                "bg-icon-success-base": current().state === "online",
                "bg-icon-critical-base": current().state === "error",
                "bg-icon-warning-base": current().state === "connecting",
              }}
            />
            <span>{stateLabel()}</span>
            <Show when={current().environmentName}>
              <span class="text-v2-text-text-faint">· {current().environmentName}</span>
            </Show>
          </div>

          <Show when={current().state === "error"}>
            <Button
              variant="ghost-muted"
              size="small"
              disabled={busy()}
              onClick={() => applyToggle(false)}
            >
              {language.t("settings.general.row.deviceSharing.stop")}
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={!hasAccount()}>
        <p class="text-[13px] leading-5 text-v2-text-text-muted">
          {language.t("settings.general.row.deviceSharing.loginHint")}
        </p>
      </Show>

      <Show when={error()}>
        <p class="text-sm text-v2-status-error" role="alert">
          {error()}
        </p>
      </Show>
    </div>
  )
}

export const SettingsGeneral: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const settings = useSettings()
  const mobile = createMediaQuery("(max-width: 767px)")
  const desktop = createMemo(() => platform.platform === "desktop")

  const pinchZoom = createOptimisticSetting({
    source: () => (desktop() && "getPinchZoomEnabled" in platform) || undefined,
    initial: false,
    initialMeta: undefined,
    load: async () => ({ value: (await platform.getPinchZoomEnabled?.()) ?? false, meta: undefined }),
    write: (checked) => platform.setPinchZoomEnabled?.(checked),
  })

  const spellcheck = createOptimisticSetting({
    source: () => (desktop() && "getSpellcheckEnabled" in platform) || undefined,
    initial: true,
    initialMeta: undefined,
    load: async () => ({ value: (await platform.getSpellcheckEnabled?.()) ?? true, meta: undefined }),
    write: (checked) => platform.setSpellcheckEnabled?.(checked),
  })

  const GeneralSection = () => (
    <div class="settings-section">
      <h3 class="settings-section-title">{language.t("settings.general.section.general")}</h3>
      <SettingsList>
        <InterfaceModeSetting />
        <LanguageSetting />

        <WorkspaceDestinationSetting />
        <AutoApprovePermissionsSetting />

        <SettingsRow
          title={language.t("settings.general.row.showCustomAgents.title")}
          description={language.t("settings.general.row.showCustomAgents.description")}
        >
          <div data-action="settings-show-custom-agents">
            <Switch
              checked={settings.general.showCustomAgents()}
              onChange={(checked) => settings.general.setShowCustomAgents(checked)}
            />
          </div>
        </SettingsRow>

        <FollowUpBehaviorSetting />

        <Show when={desktop()}>
          <SettingsRow
            title={language.t("settings.general.row.pinchZoom.title")}
            description={language.t("settings.general.row.pinchZoom.description")}
          >
            <div data-action="settings-pinch-zoom">
              <Switch checked={pinchZoom.value()} onChange={pinchZoom.select} />
            </div>
          </SettingsRow>
          <SettingsRow
            title={language.t("settings.general.row.spellcheck.title")}
            description={language.t("settings.general.row.spellcheck.description")}
          >
            <div data-action="settings-spellcheck">
              <Switch checked={spellcheck.value()} onChange={spellcheck.select} />
            </div>
          </SettingsRow>
          <DeviceSharingSetting />
        </Show>

        <PluginSettingsSections page="general" section="general" />

        <Show when={mobile()}>
          <SettingsRow
            title={language.t("settings.general.row.mobileTitlebarBottom.title")}
            description={language.t("settings.general.row.mobileTitlebarBottom.description")}
          >
            <div data-action="settings-mobile-titlebar-bottom">
              <Switch
                checked={settings.general.mobileTitlebarPosition() === "bottom"}
                onChange={(checked) => settings.general.setMobileTitlebarPosition(checked ? "bottom" : "top")}
              />
            </div>
          </SettingsRow>
        </Show>
      </SettingsList>
    </div>
  )

  return (
    <>
      <div class="settings-tab-header">
        <div class="settings-tab-header-row">
          <div class="flex flex-col gap-1">
            <h2 class="settings-tab-title">{language.t("settings.tab.preferences")}</h2>
            <span class="text-11-regular text-v2-text-text-muted">
              {language.t("settings.preferences.description")}
            </span>
          </div>
        </div>
      </div>
      <div class="settings-tab-body settings-tab-body--sectioned">
        <GeneralSection />

        <section class="settings-section" aria-label={language.t("settings.timeline.title")}>
          <h3 class="settings-section-title">{language.t("settings.timeline.title")}</h3>
          <SettingsList>
            <div class="border-b-[0.5px] border-v2-border-border-base py-5">
              <TimelineDetailControl
                value={settings.general.timelineDetail()}
                onChange={settings.general.setTimelineDetail}
              />
            </div>
            <TimelineWidthSetting />
            <BackgroundActivitySetting />
            <SettingsRow
              title={language.t("settings.timeline.row.turnDiffs.title")}
              description={language.t("settings.timeline.row.turnDiffs.description")}
            >
              <div data-action="settings-show-turn-diffs">
                <Switch
                  checked={settings.general.showTurnDiffs()}
                  onChange={(checked) => settings.general.setShowTurnDiffs(checked)}
                />
              </div>
            </SettingsRow>
          </SettingsList>
        </section>

        <PluginSettingsSections page="general" />
      </div>
    </>
  )
}
