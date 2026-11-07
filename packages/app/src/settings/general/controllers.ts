import { createEffect, createMemo, createSignal, onMount, untrack, type Accessor } from "solid-js"
import type { ConfigShellOption } from "@opencode/client/promise"
import type { ColorScheme } from "@opencode/ui/theme/context"
import { useTheme } from "@opencode/ui/theme/context"
import {
  monoDefault,
  monoFontFamily,
  monoInput,
  sansDefault,
  sansFontFamily,
  sansInput,
  type ReduceMotion,
  terminalDefault,
  terminalFontFamily,
  terminalInput,
  useSettings,
} from "@/settings/model"
import { usePlatform } from "@/runtime/platform/platform"
import { desktopZoomLevels, type DesktopZoomLevel } from "@/shell/commands/desktop-menu"
import { playSoundById, SOUND_OPTIONS } from "@/shell/notifications/sound"
import { createSoundPreviewController } from "./behavior"
import { ServerConnection } from "@/runtime/server/registry"
import { useServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { errorMessage } from "@/shell/layout/helpers"
import {
  createOptimisticSettingState,
  selectSettingMeta,
  selectSettingValue,
  transitionOptimisticSetting,
  type OptimisticSettingEffect,
  type OptimisticSettingEvent,
  type SettingWriteFailure,
} from "./machine"

/**
 * Drives one optimistically written setting. Writes outlive the owner on purpose: a queued choice still reaches the
 * source after Settings closes, and a failure still reports.
 */
export function createOptimisticSetting<T, M, S>(options: {
  /** `undefined` while no source can take the setting; another value reads it again. */
  source: Accessor<S | undefined>
  initial: T
  initialMeta: M
  load: (source: S) => Promise<{ value: T; meta: M }>
  write: (value: T, source: S) => Promise<void> | void
  onError?: (failure: SettingWriteFailure) => void
}) {
  const [state, setState] = createSignal(createOptimisticSettingState<T, M, S>(options.initial, options.initialMeta))
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const dispatch = (event: OptimisticSettingEvent<T, M, S>) =>
    untrack(() => {
      const previous = state()
      const next = transitionOptimisticSetting(previous, event)

      if (next.state !== previous) setState(next.state)
      next.effects.forEach(run)
    })

  const settle = (attempt: number, event: OptimisticSettingEvent<T, M, S>) => {
    clearTimeout(timers.get(attempt))
    timers.delete(attempt)
    dispatch(event)
  }

  function run(effect: OptimisticSettingEffect<T, S>) {
    if (effect.type === "notify.error") return options.onError?.(effect.failure)

    const attempt = effect.attempt

    if (effect.type === "load") {
      void Promise.try(() => options.load(effect.source)).then(
        (result) => dispatch({ type: "load.succeeded", attempt, value: result.value, meta: result.meta }),
        () => dispatch({ type: "load.failed", attempt }),
      )

      return
    }

    timers.set(
      attempt,
      setTimeout(() => settle(attempt, { type: "write.timed-out", attempt }), effect.timeoutMs),
    )
    void Promise.try(() => options.write(effect.value, effect.source)).then(
      () => settle(attempt, { type: "write.succeeded", attempt }),
      (cause) => settle(attempt, { type: "write.failed", attempt, message: errorMessage(cause, "") }),
    )
  }

  createEffect(() => dispatch({ type: "source.synced", source: options.source() }))

  return {
    value: () => selectSettingValue(state()),
    meta: () => selectSettingMeta(state()),
    select: (value: T) => dispatch({ type: "write.requested", value }),
  }
}

export function createServerShellController(server: Accessor<ServerConnection.Any>) {
  const language = useLanguage()

  // Reads again for the controller a server's new credentials start; a server without one keeps the last value.
  const setting = createOptimisticSetting({
    source: useServerCtx(server),
    initial: "",
    initialMeta: Array.of<ConfigShellOption>(),
    load: async (context) => {
      const [entries, shells] = await Promise.all([
        context.sdk.api.config.get().catch(() => []),
        context.sdk.api.config.shells().catch(() => []),
      ])

      const boundary = entries.findIndex((entry) => entry.type === "directory")
      const global = boundary === -1 ? entries : entries.slice(0, boundary)

      return {
        meta: shells,
        value:
          global
            .flatMap((entry) => (entry.type === "document" && entry.info.shell !== undefined ? [entry.info.shell] : []))
            .at(-1) ?? "",
      }
    },
    write: async (value, context) => {
      await context.sdk.api.experimental.config.update({ shell: value || null })
    },
    onError: (failure) =>
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description:
          failure.kind === "timeout"
            ? language.t("home.sessions.load.timeout")
            : failure.message || language.t("common.requestFailed"),
      }),
  })

  return {
    shells: setting.meta,
    current: setting.value,
    select: setting.select,
  }
}

export function createAppearanceSettingsController() {
  const settings = useSettings()
  const platform = usePlatform()
  const language = useLanguage()
  const theme = useTheme()
  const themes = createMemo(() => theme.ids().map((id) => ({ id, name: theme.name(id) })))

  onMount(() => void theme.loadThemes())

  return {
    scheme: {
      current: theme.colorScheme,
      select: (value: ColorScheme) => theme.setColorScheme(value),
    },
    theme: {
      options: themes,
      current: createMemo(() => themes().find((option) => option.id === theme.themeId())),
      select: (option: { id: string } | null) => option && theme.setTheme(option.id),
    },
    zoom: {
      available: () => platform.zoomLevel !== undefined,
      options: [...desktopZoomLevels],
      current: () => platform.zoomLevel?.() ?? 1,
      label: (level: DesktopZoomLevel) => new Intl.NumberFormat(language.intl(), { style: "percent" }).format(level),
      select: (level: DesktopZoomLevel) => void platform.setZoomLevel?.(level),
    },
    reduceMotion: {
      current: settings.appearance.reduceMotion,
      select: (value: ReduceMotion) => settings.appearance.setReduceMotion(value),
    },
    visuals: {
      current: settings.appearance.visuals,
      select: (value: "off" | "inline") => settings.appearance.setVisuals(value),
    },
    fonts: {
      ui: createMemo(() => ({
        value: sansInput(settings.appearance.uiFont()),
        family: sansFontFamily(settings.appearance.uiFont()),
        placeholder: sansDefault,
      })),
      code: createMemo(() => ({
        value: monoInput(settings.appearance.font()),
        family: monoFontFamily(settings.appearance.font()),
        placeholder: monoDefault,
      })),
      terminal: createMemo(() => ({
        value: terminalInput(settings.appearance.terminalFont()),
        family: terminalFontFamily(settings.appearance.terminalFont()),
        placeholder: terminalDefault,
      })),
      setUI: (value: string) => settings.appearance.setUIFont(value),
      setCode: (value: string) => settings.appearance.setFont(value),
      setTerminal: (value: string) => settings.appearance.setTerminalFont(value),
    },
  }
}

const noneSound = { id: "none", label: "sound.option.none" } as const

export const soundOptions = [noneSound, ...SOUND_OPTIONS]

export type SoundSelectOption = (typeof soundOptions)[number]

export function createSoundSettingsController() {
  const settings = useSettings()
  const preview = createSoundPreviewController(playSoundById)

  const channel = (
    enabled: Accessor<boolean>,
    current: Accessor<string>,
    setEnabled: (value: boolean) => void,
    set: (id: string) => void,
  ) => ({
    current: createMemo(() =>
      enabled() ? (soundOptions.find((option) => option.id === current()) ?? noneSound) : noneSound,
    ),
    highlight: (option: SoundSelectOption | undefined) => {
      if (!option) return
      preview.play(option.id === "none" ? undefined : option.id)
    },
    select: (option: SoundSelectOption | null) => {
      if (!option) return

      if (option.id === "none") {
        setEnabled(false)
        preview.stop()

        return
      }

      setEnabled(true)
      set(option.id)
      preview.play(option.id)
    },
  })

  return {
    agent: channel(
      settings.sounds.agentEnabled,
      settings.sounds.agent,
      (value) => settings.sounds.setAgentEnabled(value),
      (id) => settings.sounds.setAgent(id),
    ),
    permissions: channel(
      settings.sounds.permissionsEnabled,
      settings.sounds.permissions,
      (value) => settings.sounds.setPermissionsEnabled(value),
      (id) => settings.sounds.setPermissions(id),
    ),
    questions: channel(
      settings.sounds.questionsEnabled,
      settings.sounds.questions,
      (value) => settings.sounds.setQuestionsEnabled(value),
      (id) => settings.sounds.setQuestions(id),
    ),
    errors: channel(
      settings.sounds.errorsEnabled,
      settings.sounds.errors,
      (value) => settings.sounds.setErrorsEnabled(value),
      (id) => settings.sounds.setErrors(id),
    ),
  }
}

export type ShellSettingsController = ReturnType<typeof createServerShellController>

export type AppearanceSettingsController = ReturnType<typeof createAppearanceSettingsController>

export type SoundSettingsController = ReturnType<typeof createSoundSettingsController>
