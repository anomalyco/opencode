import { Component, For, Show, batch, createMemo, createResource, onMount, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { Select } from "@opencode-ai/ui/select"
import { Switch } from "@opencode-ai/ui/switch"
import { TextField } from "@opencode-ai/ui/text-field"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useTheme, type ColorScheme } from "@opencode-ai/ui/theme/context"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { showToast } from "@/utils/toast"
import { useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { usePermission } from "@/context/permission"
import { usePlatform, type DisplayBackend } from "@/context/platform"
import { usePush } from "@/context/push"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { useUpdaterAction } from "./updater-action"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  terminalDefault,
  terminalFontFamily,
  terminalInput,
  useSettings,
} from "@/context/settings"
import { normalizeAgentList } from "@/context/global-sync/utils"
import { decode64 } from "@/utils/base64"
import { playSoundById, SOUND_OPTIONS } from "@/utils/sound"
import { Link } from "./link"
import { SettingsList } from "./settings-list"

let demoSoundState = {
  cleanup: undefined as (() => void) | undefined,
  timeout: undefined as NodeJS.Timeout | undefined,
  run: 0,
}

type ThemeOption = {
  id: string
  name: string
}

type ShellOption = {
  path: string
  name: string
  acceptable: boolean
}

type ShellSelectOption = {
  id: string
  value: string
  label: string
}

// To prevent audio from overlapping/playing very quickly when navigating the settings menus,
// delay the playback by 100ms during quick selection changes and pause existing sounds.
const stopDemoSound = () => {
  demoSoundState.run += 1
  if (demoSoundState.cleanup) {
    demoSoundState.cleanup()
  }
  clearTimeout(demoSoundState.timeout)
  demoSoundState.cleanup = undefined
}

const playDemoSound = (id: string | undefined) => {
  stopDemoSound()
  if (!id) return

  const run = ++demoSoundState.run
  demoSoundState.timeout = setTimeout(() => {
    void playSoundById(id).then((cleanup) => {
      if (demoSoundState.run !== run) {
        cleanup?.()
        return
      }
      demoSoundState.cleanup = cleanup
    })
  }, 100)
}

export const SettingsGeneral: Component = () => {
  const theme = useTheme()
  const language = useLanguage()
  const permission = usePermission()
  const platform = usePlatform()
  const push = usePush()
  const dialog = useDialog()
  const params = useParams()
  const settings = useSettings()
  const serverSync = useServerSync()
  const serverSdk = useServerSDK()
  const updater = useUpdaterAction()

  const [store, setStore] = createStore({
    pushDeviceDrafts: {} as Record<string, string>,
    pushManaging: false,
    pushRemovingID: undefined as string | undefined,
    pushSavingID: undefined as string | undefined,
    pushTesting: false,
    pushUnsubscribing: false,
    refreshingSkills: false,
  })

  const linux = createMemo(() => platform.platform === "desktop" && platform.os === "linux")
  const dir = createMemo(() => decode64(params.dir))
  const accepting = createMemo(() => {
    const value = dir()
    if (!value) return false
    if (!params.id) return permission.isAutoAcceptingDirectory(value)
    return permission.isAutoAccepting(params.id, value)
  })

  const toggleAccept = (checked: boolean) => {
    const value = dir()
    if (!value) return

    if (!params.id) {
      if (permission.isAutoAcceptingDirectory(value) === checked) return
      permission.toggleAutoAcceptDirectory(value)
      return
    }

    if (checked) {
      permission.enableAutoAccept(params.id, value)
      return
    }

    permission.disableAutoAccept(params.id, value)
  }
  const desktop = createMemo(() => platform.platform === "desktop")
  const pushStatus = createMemo(() => {
    const current = push.current
    if (!current.supported) return language.t("settings.general.notifications.push.status.unsupported")
    if (!current.publicKey) return language.t("settings.general.notifications.push.status.unconfigured")
    if (current.permission === "denied") return language.t("settings.general.notifications.push.status.denied")
    if (current.permission !== "granted") return language.t("settings.general.notifications.push.status.permission")
    if (current.syncing) return language.t("settings.general.notifications.push.status.syncing")
    if (current.subscribed && current.enabled) return language.t("settings.general.notifications.push.status.active")
    if (current.subscribed) return language.t("settings.general.notifications.push.status.muted")
    return language.t("settings.general.notifications.push.status.unsubscribed")
  })
  const canManagePush = createMemo(() => push.current.supported && !!push.current.publicKey)
  const canTestPush = createMemo(
    () => push.current.supported && !!push.current.publicKey && push.current.permission === "granted" && !!push.current.subscriptionID,
  )
  const canUnsubscribePush = createMemo(() => push.current.subscribed && !!push.current.subscriptionID)
  const pushDevices = createMemo(() => {
    const currentID = push.current.subscriptionID
    return push.current.devices.slice().sort((a, b) => {
      if (a.id === currentID && b.id !== currentID) return -1
      if (b.id === currentID && a.id !== currentID) return 1
      return b.id.localeCompare(a.id)
    })
  })
  const formatPushTime = (time?: number) => {
    if (!time) return
    return new Date(time).toLocaleString()
  }
  const describePushDevice = (device: (typeof push.current.devices)[number]) => {
    if (device.lastError) {
      return language.t("settings.general.notifications.push.devices.item.error", {
        count: device.failureCount,
        error: device.lastError,
      })
    }
    if (device.lastSuccessAt) {
      return language.t("settings.general.notifications.push.devices.item.lastSuccess", {
        time: formatPushTime(device.lastSuccessAt) ?? "",
      })
    }
    return language.t("settings.general.notifications.push.devices.item.pending")
  }
  const deviceDraft = (device: (typeof push.current.devices)[number]) => {
    const draft = store.pushDeviceDrafts[device.id]
    if (draft !== undefined) return draft
    return device.deviceLabel || ""
  }
  const savePushDevice = async (device: (typeof push.current.devices)[number]) => {
    const next = deviceDraft(device)
    const current = device.deviceLabel || ""
    if (next.trim() === current.trim()) return
    setStore("pushSavingID", device.id)
    try {
      const updated = await push.updateDeviceLabel(device.id, next)
      if (updated) {
        setStore("pushDeviceDrafts", device.id, undefined as unknown as string)
        showToast({
          variant: "success",
          title: language.t("settings.general.notifications.push.devices.toast.saved.title"),
          description: language.t("settings.general.notifications.push.devices.toast.saved.description"),
        })
        return
      }

      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("settings.general.notifications.push.devices.toast.saveFailed"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setStore("pushSavingID", undefined)
    }
  }
  const togglePushDevice = async (device: (typeof push.current.devices)[number]) => {
    setStore("pushSavingID", device.id)
    try {
      const updated = await push.setDeviceEnabled(device.id, !device.enabled)
      if (updated) {
        showToast({
          variant: "success",
          title: language.t(
            device.enabled
              ? "settings.general.notifications.push.devices.toast.muted.title"
              : "settings.general.notifications.push.devices.toast.unmuted.title",
          ),
          description: language.t(
            device.enabled
              ? "settings.general.notifications.push.devices.toast.muted.description"
              : "settings.general.notifications.push.devices.toast.unmuted.description",
          ),
        })
        return
      }

      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("settings.general.notifications.push.devices.toast.toggleFailed"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setStore("pushSavingID", undefined)
    }
  }
  const pushAction = createMemo(() => {
    if (!push.current.supported) return language.t("settings.general.notifications.push.action.unsupported")
    if (!push.current.publicKey) return language.t("settings.general.notifications.push.action.unconfigured")
    if (push.current.permission !== "granted") return language.t("settings.general.notifications.push.action.enable")
    if (!push.current.subscribed) return language.t("settings.general.notifications.push.action.sync")
    return language.t("settings.general.notifications.push.action.refresh")
  })

  const managePush = async () => {
    if (!canManagePush()) return
    setStore("pushManaging", true)
    try {
      if (push.current.permission !== "granted") {
        const result = await push.requestPermission()
        if (result !== "granted") {
          showToast({
            title: language.t("common.requestFailed"),
            description: language.t("settings.general.notifications.push.toast.permissionDenied"),
          })
          return
        }
      }

      await push.sync()
      showToast({
        variant: "success",
        title: language.t("settings.general.notifications.push.toast.synced.title"),
        description: language.t("settings.general.notifications.push.toast.synced.description"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setStore("pushManaging", false)
    }
  }

  const sendTestPush = async () => {
    setStore("pushTesting", true)
    try {
      const sent = await push.test()
      if (sent) {
        showToast({
          variant: "success",
          title: language.t("settings.general.notifications.push.toast.testSent.title"),
          description: language.t("settings.general.notifications.push.toast.testSent.description"),
        })
        return
      }

      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("settings.general.notifications.push.toast.testFailed"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setStore("pushTesting", false)
    }
  }

  const removePush = async () => {
    setStore("pushUnsubscribing", true)
    try {
      const removed = await push.unsubscribe()
      if (removed) {
        showToast({
          variant: "success",
          title: language.t("settings.general.notifications.push.toast.unsubscribed.title"),
          description: language.t("settings.general.notifications.push.toast.unsubscribed.description"),
        })
        return
      }

      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("settings.general.notifications.push.toast.unsubscribeFailed"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setStore("pushUnsubscribing", false)
    }
  }

  const removePushDevice = async (id: string) => {
    setStore("pushRemovingID", id)
    try {
      const removed = await push.removeDevice(id)
      if (removed) {
        showToast({
          variant: "success",
          title: language.t("settings.general.notifications.push.devices.toast.removed.title"),
          description: language.t("settings.general.notifications.push.devices.toast.removed.description"),
        })
        return
      }

      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("settings.general.notifications.push.devices.toast.removeFailed"),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setStore("pushRemovingID", undefined)
    }
  }

  const refreshSkills = async () => {
    const value = dir()
    if (!value) return

    setStore("refreshingSkills", true)
    try {
      const client = serverSdk().createClient({ directory: value, throwOnError: true })
      const skills = await client.app.refreshSkills()
      const [agents, commands] = await Promise.all([client.app.agents(), client.command.list()])
      const [, setWorkspace] = serverSync().child(value, { bootstrap: false })
      batch(() => {
        setWorkspace("agent", normalizeAgentList(agents.data))
        setWorkspace("command", commands.data ?? [])
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("settings.general.skills.toast.refreshed.title"),
        description: language.t("settings.general.skills.toast.refreshed.description", {
          count: skills.data?.length ?? 0,
        }),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      showToast({ title: language.t("common.requestFailed"), description: message })
    } finally {
      setStore("refreshingSkills", false)
    }
  }

  const themeOptions = createMemo<ThemeOption[]>(() => theme.ids().map((id) => ({ id, name: theme.name(id) })))

  const [shells] = createResource(
    () =>
      serverSdk()
        .client.pty.shells()
        .then((res) => res.data ?? [])
        .catch(() => [] as ShellOption[]),
    { initialValue: [] as ShellOption[] },
  )

  const [displayBackend, { refetch: refetchDisplayBackend }] = createResource(
    () => (linux() && platform.getDisplayBackend ? true : false),
    () => Promise.resolve(platform.getDisplayBackend?.() ?? null).catch(() => null as DisplayBackend | null),
    { initialValue: null as DisplayBackend | null },
  )

  const [pinchZoom, { mutate: setPinchZoom }] = createResource(
    () => (desktop() && platform.getPinchZoomEnabled ? true : false),
    () => Promise.resolve(platform.getPinchZoomEnabled?.() ?? false).catch(() => false),
    { initialValue: false },
  )

  onMount(() => {
    void theme.loadThemes()
  })

  const autoOption = { id: "auto", value: "", label: language.t("settings.general.row.shell.autoDefault") }
  const currentShell = createMemo(() => serverSync().data.config.shell ?? "")

  const shellOptions = createMemo<ShellSelectOption[]>(() => {
    const list = shells.latest
    const current = serverSync().data.config.shell

    const nameCounts = new Map<string, number>()
    for (const s of list) {
      nameCounts.set(s.name, (nameCounts.get(s.name) || 0) + 1)
    }

    const options = [
      autoOption,
      ...list.map((s) => {
        const ambiguousName = (nameCounts.get(s.name) || 0) > 1
        const text = ambiguousName ? s.path : s.name
        const label = s.acceptable ? text : `${text} (${language.t("settings.general.row.shell.terminalOnly")})`
        return {
          id: s.path,
          // Prefer name over path - "bash" is much cleaner than the explicit full route even when it may change due to PATH.
          value: ambiguousName ? s.path : s.name,
          label,
        }
      }),
    ]

    if (current && !options.some((o) => o.value === current)) {
      options.push({ id: current, value: current, label: current })
    }

    return options
  })

  const onDisplayBackendChange = (checked: boolean) => {
    const update = platform.setDisplayBackend?.(checked ? "wayland" : "auto")
    if (!update) return
    void update.finally(() => {
      void refetchDisplayBackend()
    })
  }

  const onPinchZoomChange = (checked: boolean) => {
    setPinchZoom(checked)
    const update = platform.setPinchZoomEnabled?.(checked)
    if (!update) return
    void update.catch(() => setPinchZoom(!checked))
  }

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

  const noneSound = { id: "none", label: "sound.option.none" } as const
  const soundOptions = [noneSound, ...SOUND_OPTIONS]
  const mono = () => monoInput(settings.appearance.font())
  const sans = () => sansInput(settings.appearance.uiFont())
  const terminal = () => terminalInput(settings.appearance.terminalFont())

  const soundSelectProps = (
    enabled: () => boolean,
    current: () => string,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    options: soundOptions,
    current: enabled() ? (soundOptions.find((o) => o.id === current()) ?? noneSound) : noneSound,
    value: (o: (typeof soundOptions)[number]) => o.id,
    label: (o: (typeof soundOptions)[number]) => language.t(o.label),
    onHighlight: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      playDemoSound(option.id === "none" ? undefined : option.id)
    },
    onSelect: (option: (typeof soundOptions)[number] | undefined) => {
      if (!option) return
      if (option.id === "none") {
        setEnabled(false)
        stopDemoSound()
        return
      }
      setEnabled(true)
      set(option.id)
      playDemoSound(option.id)
    },
    variant: "secondary" as const,
    size: "small" as const,
    triggerVariant: "settings" as const,
  })

  const GeneralSection = () => (
    <div class="flex flex-col gap-1">
      <SettingsList>
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
          title={language.t("command.permissions.autoaccept.enable")}
          description={language.t("toast.permissions.autoaccept.on.description")}
        >
          <div data-action="settings-auto-accept-permissions">
            <Switch checked={accepting()} disabled={!dir()} onChange={toggleAccept} />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.skills.refresh.title")}
          description={language.t("settings.general.skills.refresh.description")}
        >
          <Button
            size="small"
            variant="secondary"
            disabled={store.refreshingSkills || !dir()}
            onClick={() => void refreshSkills()}
          >
            {store.refreshingSkills
              ? language.t("settings.general.skills.refresh.action.refreshing")
              : language.t("settings.general.skills.refresh.action")}
          </Button>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.shell.title")}
          description={language.t("settings.general.row.shell.description")}
        >
          <Select
            data-action="settings-shell"
            options={shellOptions()}
            current={shellOptions().find((o) => o.value === currentShell()) ?? autoOption}
            value={(o) => o.id}
            label={(o) => o.label}
            onSelect={(option) => {
              if (!option) return
              if (option.value === currentShell()) return
              serverSync().updateConfig({ shell: option.value })
            }}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            triggerStyle={{ "min-width": "180px" }}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.reasoningSummaries.title")}
          description={language.t("settings.general.row.reasoningSummaries.description")}
        >
          <div data-action="settings-feed-reasoning-summaries">
            <Switch
              checked={settings.general.showReasoningSummaries()}
              onChange={(checked) => settings.general.setShowReasoningSummaries(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.shellToolPartsExpanded.title")}
          description={language.t("settings.general.row.shellToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-shell-tool-parts-expanded">
            <Switch
              checked={settings.general.shellToolPartsExpanded()}
              onChange={(checked) => settings.general.setShellToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.editToolPartsExpanded.title")}
          description={language.t("settings.general.row.editToolPartsExpanded.description")}
        >
          <div data-action="settings-feed-edit-tool-parts-expanded">
            <Switch
              checked={settings.general.editToolPartsExpanded()}
              onChange={(checked) => settings.general.setEditToolPartsExpanded(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showSessionProgressBar.title")}
          description={language.t("settings.general.row.showSessionProgressBar.description")}
        >
          <div data-action="settings-show-session-progress-bar">
            <Switch
              checked={settings.general.showSessionProgressBar()}
              onChange={(checked) => settings.general.setShowSessionProgressBar(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.newLayoutDesigns.title")}
          description={language.t("settings.general.row.newLayoutDesigns.description")}
        >
          <div data-action="settings-new-layout-designs">
            <Switch
              checked={settings.general.newLayoutDesigns()}
              onChange={(checked) => {
                settings.general.setNewLayoutDesigns(checked)
                if (!checked) return
                void import("@/components/settings-v2").then((module) => {
                  dialog.show(() => <module.DialogSettings />)
                })
              }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const AdvancedSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.advanced")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.showFileTree.title")}
          description={language.t("settings.general.row.showFileTree.description")}
        >
          <div data-action="settings-show-file-tree">
            <Switch
              checked={settings.general.showFileTree()}
              onChange={(checked) => settings.general.setShowFileTree(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showNavigation.title")}
          description={language.t("settings.general.row.showNavigation.description")}
        >
          <div data-action="settings-show-navigation">
            <Switch
              checked={settings.general.showNavigation()}
              onChange={(checked) => settings.general.setShowNavigation(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showSearch.title")}
          description={language.t("settings.general.row.showSearch.description")}
        >
          <div data-action="settings-show-search">
            <Switch
              checked={settings.general.showSearch()}
              onChange={(checked) => settings.general.setShowSearch(checked)}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.showStatus.title")}
          description={language.t("settings.general.row.showStatus.description")}
        >
          <div data-action="settings-show-status">
            <Switch
              checked={settings.general.showStatus()}
              onChange={(checked) => settings.general.setShowStatus(checked)}
            />
          </div>
        </SettingsRow>

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
      </SettingsList>
    </div>
  )

  const AppearanceSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.appearance")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.row.colorScheme.title")}
          description={language.t("settings.general.row.colorScheme.description")}
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
            triggerStyle={{ "min-width": "220px" }}
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
          title={language.t("settings.general.row.uiFont.title")}
          description={language.t("settings.general.row.uiFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-ui-font"
              label={language.t("settings.general.row.uiFont.title")}
              hideLabel
              type="text"
              value={sans()}
              onChange={(value) => settings.appearance.setUIFont(value)}
              placeholder={sansDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": sansFontFamily(settings.appearance.uiFont()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.font.title")}
          description={language.t("settings.general.row.font.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-code-font"
              label={language.t("settings.general.row.font.title")}
              hideLabel
              type="text"
              value={mono()}
              onChange={(value) => settings.appearance.setFont(value)}
              placeholder={monoDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": monoFontFamily(settings.appearance.font()) }}
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.row.terminalFont.title")}
          description={language.t("settings.general.row.terminalFont.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-terminal-font"
              label={language.t("settings.general.row.terminalFont.title")}
              hideLabel
              type="text"
              value={terminal()}
              onChange={(value) => settings.appearance.setTerminalFont(value)}
              placeholder={terminalDefault}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="off"
              class="text-12-regular"
              style={{ "font-family": terminalFontFamily(settings.appearance.terminalFont()) }}
            />
          </div>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const NotificationsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.notifications")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.notifications.push.title")}
          description={
            <span class="flex flex-col gap-0.5">
              <span>{language.t("settings.general.notifications.push.description")}</span>
              <span>{pushStatus()}</span>
              <Show when={push.current.serverOrigin}>
                {(origin) => <span>{language.t("settings.general.notifications.push.origin", { origin: origin() })}</span>}
              </Show>
              <Show when={formatPushTime(push.current.lastSuccessAt)}>
                {(time) => <span>{language.t("settings.general.notifications.push.diagnostics.lastSuccess", { time: time() })}</span>}
              </Show>
              <Show when={formatPushTime(push.current.lastFailureAt)}>
                {(time) => <span>{language.t("settings.general.notifications.push.diagnostics.lastFailure", { time: time() })}</span>}
              </Show>
              <Show when={push.current.failureCount > 0}>
                <span>{language.t("settings.general.notifications.push.diagnostics.failureCount", { count: push.current.failureCount })}</span>
              </Show>
              <Show when={push.current.lastError}>
                {(error) => <span>{language.t("settings.general.notifications.push.diagnostics.lastError", { error: error() })}</span>}</Show>
            </span>
          }
        >
          <Button size="small" variant="secondary" disabled={!canManagePush() || store.pushManaging} onClick={managePush}>
            {store.pushManaging ? language.t("settings.general.notifications.push.action.syncing") : pushAction()}
          </Button>
        </SettingsRow>

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

        <SettingsRow
          title={language.t("settings.general.notifications.push.device.title")}
          description={language.t("settings.general.notifications.push.device.description")}
        >
          <div class="w-full sm:w-[220px]">
            <TextField
              data-action="settings-notifications-push-device"
              label={language.t("settings.general.notifications.push.device.title")}
              hideLabel
              type="text"
              value={push.current.deviceLabel}
              onChange={(value) => push.setDeviceLabel(value)}
              placeholder={language.t("settings.general.notifications.push.device.placeholder")}
              spellcheck={false}
              autocorrect="off"
              autocomplete="off"
              autocapitalize="words"
              class="text-12-regular"
            />
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.push.devices.title")}
          description={language.t("settings.general.notifications.push.devices.description")}
        >
          <div class="w-full sm:w-[320px] flex flex-col gap-2">
            <Show
              when={pushDevices().length > 0}
              fallback={<div class="text-12-regular text-text-weak">{language.t("settings.general.notifications.push.devices.empty")}</div>}
            >
              <For each={pushDevices()}>
                {(device) => (
                  <div class="flex items-start justify-between gap-3 rounded-sm border border-border-weak-base bg-surface-raised-base px-3 py-2">
                    <div class="min-w-0 flex flex-col gap-0.5">
                      <Show
                        when={device.id === push.current.subscriptionID}
                        fallback={
                          <div class="w-full sm:w-[180px]">
                            <TextField
                              label={language.t("settings.general.notifications.push.devices.item.label")}
                              hideLabel
                              type="text"
                              value={deviceDraft(device)}
                              onChange={(value) => setStore("pushDeviceDrafts", device.id, value)}
                              placeholder={language.t("settings.general.notifications.push.device.placeholder")}
                              spellcheck={false}
                              autocorrect="off"
                              autocomplete="off"
                              autocapitalize="words"
                              class="text-12-regular"
                            />
                          </div>
                        }
                      >
                        <div class="text-12-medium text-text-base truncate">
                          {device.deviceLabel || language.t("settings.general.notifications.push.device.placeholder")}
                        </div>
                      </Show>
                      <Show when={device.id === push.current.subscriptionID}>
                        <div class="text-11-regular text-text-weak">
                          {language.t("settings.general.notifications.push.devices.item.current")}
                        </div>
                      </Show>
                      <div class="text-11-regular text-text-weak break-words">{describePushDevice(device)}</div>
                      <Show when={!device.enabled}>
                        <div class="text-11-regular text-text-weak">
                          {language.t("settings.general.notifications.push.devices.item.muted")}
                        </div>
                      </Show>
                    </div>
                    <Show when={device.id !== push.current.subscriptionID}>
                      <div class="flex flex-col gap-2 items-end">
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={store.pushSavingID === device.id || deviceDraft(device).trim() === (device.deviceLabel || "").trim()}
                          onClick={() => savePushDevice(device)}
                        >
                          {store.pushSavingID === device.id
                            ? language.t("settings.general.notifications.push.devices.action.saving")
                            : language.t("settings.general.notifications.push.devices.action.save")}
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={store.pushSavingID === device.id}
                          onClick={() => togglePushDevice(device)}
                        >
                          {store.pushSavingID === device.id
                            ? language.t("settings.general.notifications.push.devices.action.saving")
                            : language.t(
                                device.enabled
                                  ? "settings.general.notifications.push.devices.action.mute"
                                  : "settings.general.notifications.push.devices.action.unmute",
                              )}
                        </Button>
                        <Button
                          size="small"
                          variant="secondary"
                          disabled={store.pushRemovingID === device.id}
                          onClick={() => removePushDevice(device.id)}
                        >
                          {store.pushRemovingID === device.id
                            ? language.t("settings.general.notifications.push.devices.action.removing")
                            : language.t("settings.general.notifications.push.devices.action.remove")}
                        </Button>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.push.test.title")}
          description={language.t("settings.general.notifications.push.test.description")}
        >
          <Button size="small" variant="secondary" disabled={!canTestPush() || store.pushTesting} onClick={sendTestPush}>
            {store.pushTesting
              ? language.t("settings.general.notifications.push.action.testing")
              : language.t("settings.general.notifications.push.action.test")}
          </Button>
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.notifications.push.unsubscribe.title")}
          description={language.t("settings.general.notifications.push.unsubscribe.description")}
        >
          <Button
            size="small"
            variant="secondary"
            disabled={!canUnsubscribePush() || store.pushUnsubscribing}
            onClick={removePush}
          >
            {store.pushUnsubscribing
              ? language.t("settings.general.notifications.push.action.unsubscribing")
              : language.t("settings.general.notifications.push.action.unsubscribe")}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const SoundsSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.sounds")}</h3>

      <SettingsList>
        <SettingsRow
          title={language.t("settings.general.sounds.agent.title")}
          description={language.t("settings.general.sounds.agent.description")}
        >
          <Select
            data-action="settings-sounds-agent"
            {...soundSelectProps(
              () => settings.sounds.agentEnabled(),
              () => settings.sounds.agent(),
              (value) => settings.sounds.setAgentEnabled(value),
              (id) => settings.sounds.setAgent(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.permissions.title")}
          description={language.t("settings.general.sounds.permissions.description")}
        >
          <Select
            data-action="settings-sounds-permissions"
            {...soundSelectProps(
              () => settings.sounds.permissionsEnabled(),
              () => settings.sounds.permissions(),
              (value) => settings.sounds.setPermissionsEnabled(value),
              (id) => settings.sounds.setPermissions(id),
            )}
          />
        </SettingsRow>

        <SettingsRow
          title={language.t("settings.general.sounds.errors.title")}
          description={language.t("settings.general.sounds.errors.description")}
        >
          <Select
            data-action="settings-sounds-errors"
            {...soundSelectProps(
              () => settings.sounds.errorsEnabled(),
              () => settings.sounds.errors(),
              (value) => settings.sounds.setErrorsEnabled(value),
              (id) => settings.sounds.setErrors(id),
            )}
          />
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const UpdatesSection = () => (
    <div class="flex flex-col gap-1">
      <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.updates")}</h3>

      <SettingsList>
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
          <Button size="small" variant="secondary" disabled={!updater.action().run} onClick={updater.run}>
            {language.t(updater.action().label)}
          </Button>
        </SettingsRow>
      </SettingsList>
    </div>
  )

  const DisplaySection = () => (
    <Show when={desktop()}>
      <div class="flex flex-col gap-1">
        <h3 class="text-14-medium text-text-strong pb-2">{language.t("settings.general.section.display")}</h3>

        <SettingsList>
          <SettingsRow
            title={language.t("settings.general.row.pinchZoom.title")}
            description={language.t("settings.general.row.pinchZoom.description")}
          >
            <div data-action="settings-pinch-zoom">
              <Switch checked={pinchZoom.latest} onChange={onPinchZoomChange} />
            </div>
          </SettingsRow>

          <Show when={linux()}>
            <SettingsRow
              title={
                <div class="flex items-center gap-2">
                  <span>{language.t("settings.general.row.wayland.title")}</span>
                  <Tooltip value={language.t("settings.general.row.wayland.tooltip")} placement="top">
                    <span class="text-text-weak">
                      <Icon name="help" size="small" />
                    </span>
                  </Tooltip>
                </div>
              }
              description={language.t("settings.general.row.wayland.description")}
            >
              <div data-action="settings-wayland">
                <Switch checked={displayBackend.latest === "wayland"} onChange={onDisplayBackendChange} />
              </div>
            </SettingsRow>
          </Show>
        </SettingsList>
      </div>
    </Show>
  )

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.tab.general")}</h2>
        </div>
      </div>

      <div class="flex flex-col gap-8 w-full">
        <GeneralSection />

        <AppearanceSection />

        <NotificationsSection />

        <SoundsSection />

        <UpdatesSection />

        <DisplaySection />

        <Show when={desktop()}>
          <AdvancedSection />
        </Show>
      </div>
    </div>
  )
}

interface SettingsRowProps {
  title: string | JSX.Element
  description: string | JSX.Element
  children: JSX.Element
}

const SettingsRow: Component<SettingsRowProps> = (props) => {
  return (
    <div class="flex flex-wrap items-center gap-4 py-3 border-b border-border-weak-base last:border-none sm:flex-nowrap">
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="text-14-medium text-text-strong">{props.title}</span>
        <span class="text-12-regular text-text-weak">{props.description}</span>
      </div>
      <div class="flex w-full justify-end sm:w-auto sm:shrink-0">{props.children}</div>
    </div>
  )
}
