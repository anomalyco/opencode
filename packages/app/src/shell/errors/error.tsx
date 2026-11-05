import { TextField } from "@opencode/ui/text-field"
import type { captureException } from "@sentry/solid"
import { Logo } from "@opencode/ui/logo"
import { Button } from "@opencode/ui/button"
import { Component, createEffect, createSignal, on, onCleanup, onMount, Show, untrack } from "solid-js"
import { Predicate } from "effect"
import { Updater } from "@opencode/plugin/gui/updater"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { createIpcClients } from "@/runtime/plugin/ipc"
import { Icon } from "@opencode/ui/icon"
import { errorDescriptionKey, errorStatus } from "./description"
import {
  INITIAL_ERROR_PAGE_STATE,
  isUpdaterBusy,
  selectActionError,
  selectCanReport,
  selectCheckingUpdates,
  selectCheckUpdatesDisabled,
  selectExportDisabled,
  selectInstallUpdateDisabled,
  selectReportDisabled,
  selectReported,
  selectUpdateVersion,
  transitionErrorPage,
  type ErrorPageEffect,
  type ErrorPageEvent,
} from "./machine"

type InitError = {
  name: unknown
  data: object
}

type Translator = ReturnType<typeof useLanguage>["t"]

const CHAIN_SEPARATOR = "\n" + "─".repeat(40) + "\n"

function isIssue(value: unknown): value is { message: string; path: string[] } {
  return (
    Predicate.hasProperty(value, "message") &&
    Predicate.hasProperty(value, "path") &&
    Predicate.isString(value.message) &&
    Array.isArray(value.path) &&
    value.path.every(Predicate.isString)
  )
}

function isInitError(value: unknown): value is InitError {
  return (
    Predicate.hasProperty(value, "name") &&
    Predicate.hasProperty(value, "data") &&
    Predicate.isObjectKeyword(value.data) &&
    !Predicate.isFunction(value.data)
  )
}

/** A field of an init error's payload when `is` accepts it. */
function read<T>(error: InitError, key: string, is: (value: unknown) => value is T) {
  const value = Predicate.hasProperty(error.data, key) ? error.data[key] : undefined

  return is(value) ? value : undefined
}

function safeJson(cause: unknown, circular: string): string {
  const seen = new WeakSet<object>()

  const json = JSON.stringify(
    cause,
    (_key, val) => {
      if (Predicate.isBigInt(val)) return val.toString()

      if (Predicate.isObjectKeyword(val) && !Predicate.isFunction(val)) {
        if (seen.has(val)) return circular
        seen.add(val)
      }

      return val
    },
    2,
  )

  return json ?? String(cause)
}

function formatInitError(error: InitError, t: Translator): string {
  const json = (cause: unknown) => safeJson(cause, t("error.page.circular"))

  // The field as text: the string itself, else its JSON.
  const shown = (key: string) => read(error, key, Predicate.isString) ?? json(read(error, key, Predicate.isUnknown))

  switch (error.name) {
    case "MCPFailed": {
      const name = read(error, "name", Predicate.isString) ?? ""

      return t("error.chain.mcpFailed", { name })
    }

    case "ProviderAuthError": {
      const providerID = read(error, "providerID", Predicate.isString) ?? t("common.unknown")

      return t("error.chain.providerAuthFailed", { provider: providerID, message: shown("message") })
    }

    case "APIError": {
      const message = read(error, "message", Predicate.isString) ?? t("error.chain.apiError")
      const lines: string[] = [message]
      const statusCode = read(error, "statusCode", Predicate.isNumber)
      const retryable = read(error, "isRetryable", Predicate.isBoolean)
      const responseBody = read(error, "responseBody", Predicate.isString)

      if (statusCode !== undefined) {
        lines.push(t("error.chain.status", { status: statusCode }))
      }

      if (retryable !== undefined) {
        lines.push(t("error.chain.retryable", { retryable }))
      }

      if (responseBody) {
        lines.push(t("error.chain.responseBody", { body: responseBody }))
      }

      return lines.join("\n")
    }

    case "ProviderModelNotFoundError": {
      const suggestions = read(error, "suggestions", Array.isArray)

      const suggestionsLine = suggestions?.length
        ? [t("error.chain.didYouMean", { suggestions: suggestions.join(", ") })]
        : []

      return [
        t("error.chain.modelNotFound", {
          provider: read(error, "providerID", Predicate.isString) ?? "",
          model: read(error, "modelID", Predicate.isString) ?? "",
        }),
        ...suggestionsLine,
        t("error.chain.checkConfig"),
      ].join("\n")
    }

    case "ProviderInitError": {
      const providerID = read(error, "providerID", Predicate.isString) ?? t("common.unknown")

      return t("error.chain.providerInitFailed", { provider: providerID })
    }

    case "ConfigJsonError": {
      const path = shown("path")
      const message = read(error, "message", Predicate.isString) ?? ""

      if (message) return t("error.chain.configJsonInvalidWithMessage", { path, message })

      return t("error.chain.configJsonInvalid", { path })
    }

    case "ConfigDirectoryTypoError":
      return t("error.chain.configDirectoryTypo", {
        dir: shown("dir"),
        path: shown("path"),
        suggestion: shown("suggestion"),
      })

    case "ConfigFrontmatterError":
      return t("error.chain.configFrontmatterError", { path: shown("path"), message: shown("message") })

    case "ConfigInvalidError": {
      const issues = (read(error, "issues", Array.isArray) ?? [])
        .filter(isIssue)
        .map((issue) => "↳ " + issue.message + " " + issue.path.join("."))

      const message = read(error, "message", Predicate.isString) ?? ""
      const path = shown("path")

      const line = message
        ? t("error.chain.configInvalidWithMessage", { path, message })
        : t("error.chain.configInvalid", { path })

      return [line, ...issues].join("\n")
    }

    default:
      return read(error, "message", Predicate.isString) ?? json(error.data)
  }
}

function formatErrorChain(cause: unknown, t: Translator, depth = 0, parentMessage?: string): string {
  if (!cause) return t("error.chain.unknown")

  if (isInitError(cause)) {
    const message = formatInitError(cause, t)

    if (depth > 0 && parentMessage === message) return ""

    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}${t("error.chain.causedBy")}\n` : ""

    return indent + `${cause.name}\n${message}`
  }

  if (cause instanceof Error) {
    const isDuplicate = depth > 0 && parentMessage === cause.message
    const parts: string[] = []
    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}${t("error.chain.causedBy")}\n` : ""

    const header = `${cause.name}${cause.message ? `: ${cause.message}` : ""}`
    const stack = cause.stack?.trim()

    if (stack) {
      const startsWithHeader = stack.startsWith(header)

      if (isDuplicate && startsWithHeader) {
        const trace = stack.split("\n").slice(1).join("\n").trim()

        if (trace) {
          parts.push(indent + trace)
        }
      }

      if (isDuplicate && !startsWithHeader) {
        parts.push(indent + stack)
      }

      if (!isDuplicate && startsWithHeader) {
        parts.push(indent + stack)
      }

      if (!isDuplicate && !startsWithHeader) {
        parts.push(indent + `${header}\n${stack}`)
      }
    }

    if (!stack && !isDuplicate) {
      parts.push(indent + header)
    }

    if (cause.cause) {
      const causeResult = formatErrorChain(cause.cause, t, depth + 1, cause.message)

      if (causeResult) {
        parts.push(causeResult)
      }
    }

    return parts.join("\n\n")
  }

  if (Predicate.isString(cause)) {
    if (depth > 0 && parentMessage === cause) return ""

    const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}${t("error.chain.causedBy")}\n` : ""

    return indent + cause
  }

  const indent = depth > 0 ? `\n${CHAIN_SEPARATOR}${t("error.chain.causedBy")}\n` : ""

  return indent + safeJson(cause, t("error.page.circular"))
}

function formatError(cause: unknown, t: Translator): string {
  return formatErrorChain(cause, t, 0)
}

interface ErrorPageProps {
  error: unknown
}

export const ErrorPage: Component<ErrorPageProps> = (props) => {
  const platform = usePlatform()
  const language = useLanguage()
  const formattedError = () => formatError(props.error, language.t)
  const status = () => errorStatus(props.error)
  const [pageState, setPageState] = createSignal(INITIAL_ERROR_PAGE_STATE)
  let capture: typeof captureException | undefined
  // The crash record in flight, which Export Logs waits for instead of recording the crash twice.
  let recording: Promise<boolean> | undefined
  const timers = new Set<ReturnType<typeof setTimeout>>()

  // A crash can take the plugin root down with the app, so the page reaches the updater's
  // main-process Ipc over the bridge itself.
  const ipcs = createIpcClients(platform.plugins)
  const updater = () => ipcs.typed(Updater)

  const dispatch = (event: ErrorPageEvent) => {
    const previous = untrack(pageState)
    const next = transitionErrorPage(previous, event)

    if (next.state !== previous) setPageState(next.state)
    next.effects.forEach(run)
  }

  function run(effect: ErrorPageEffect) {
    if (effect.type === "sentry.capture") return capture?.(props.error)

    if (effect.type === "fatal.record") {
      const attempt = effect.attempt
      void record(attempt)
      later(effect.timeoutMs, () => dispatch({ type: "fatal.settled", attempt, recorded: false }))

      return
    }

    const attempt = effect.attempt

    // Each action resolves to its error message, or undefined when it succeeded.
    const settle = (work: Promise<string | undefined>) =>
      void work.then(
        (error) =>
          dispatch(
            error === undefined ? { type: "action.succeeded", attempt } : { type: "action.failed", attempt, error },
          ),
        (cause) => dispatch({ type: "action.failed", attempt, error: formatError(cause, language.t) }),
      )

    if (effect.type === "logs.export") {
      const recorded = effect.recordFirst ? (recording ?? record(effect.fatalAttempt)) : Promise.resolve(true)

      // A crash that cannot be recorded still leaves the logs to export; the native save dialog has no time limit.
      return settle(
        within(recorded, effect.recordTimeoutMs)
          .then(() => platform.exportDebugLogs?.())
          .then(() => undefined),
      )
    }

    later(effect.timeoutMs, () =>
      dispatch({ type: "action.timed-out", attempt, error: language.t("common.requestFailed") }),
    )

    if (effect.type === "updater.install") return settle(Promise.try(() => updater()?.install()).then(() => undefined))

    settle(
      Promise.try(() => updater()?.check()).then((state) => (state?.status === "error" ? state.message : undefined)),
    )
  }

  function record(attempt: number) {
    const pending = Promise.try(() =>
      platform.recordFatalRendererError?.({
        error: formattedError(),
        url: location.href,
        version: platform.version,
        platform: platform.platform,
        os: platform.os,
      }),
    ).then(
      () => true,
      () => false,
    )

    recording = pending
    void pending.then((recorded) => {
      if (recording === pending) recording = undefined
      dispatch({ type: "fatal.settled", attempt, recorded })
    })

    return pending
  }

  function later(ms: number, fn: () => void) {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, ms)

    timers.add(timer)
  }

  function within(promise: Promise<unknown>, ms: number) {
    return new Promise<void>((resolve) => {
      later(ms, resolve)
      void promise.then(() => resolve())
    })
  }

  createEffect(
    on(
      () => props.error,
      () => dispatch({ type: "error.presented" }),
    ),
  )

  onMount(() => {
    void import("@sentry/solid")
      .then(({ captureException, isEnabled }) => {
        const enabled = isEnabled()

        if (enabled) capture = captureException
        dispatch({ type: "sentry.loaded", enabled })
      })
      .catch(() => undefined)
  })

  onCleanup(() => {
    ipcs.dispose()
    timers.forEach(clearTimeout)
    dispatch({ type: "disposed" })
  })

  return (
    <div
      class="relative flex-1 h-full w-full min-h-0 min-w-0 overflow-y-auto flex flex-col items-center justify-start sm:justify-center p-4 sm:p-8 font-sans"
      data-tauri-drag-region
    >
      <div class="w-full max-w-3xl flex flex-col items-center justify-center gap-6 sm:gap-8 my-auto">
        <Logo class="w-48 sm:w-58.5 opacity-12 shrink-0" />
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">
            {language.t(status() ? "error.page.title.status" : "error.page.title")}
          </h1>
          <p class="text-sm text-text-weak">
            {status()
              ? language.t("error.page.description.status", { status: status()! })
              : language.t(errorDescriptionKey(props.error))}
          </p>
        </div>
        <TextField
          value={formattedError()}
          readOnly
          copyable
          multiline
          class="max-h-96 w-full font-mono text-xs no-scrollbar"
          label={language.t("error.page.details.label")}
          hideLabel
        />
        <div class="flex flex-row items-center justify-center gap-3 flex-wrap max-w-64">
          <Button size="large" onClick={platform.restart}>
            {language.t(platform.platform === "web" ? "error.page.action.reload" : "error.page.action.restart")}
          </Button>
          <Show when={platform.platform === "desktop" && platform.exportDebugLogs}>
            <Button
              size="large"
              variant="ghost"
              disabled={selectExportDisabled(pageState())}
              onClick={() => dispatch({ type: "export.clicked", available: !!platform.exportDebugLogs })}
            >
              {language.t("error.page.action.exportLogs")}
            </Button>
          </Show>
          <Show when={selectCanReport(pageState())}>
            <Button
              size="large"
              disabled={selectReportDisabled(pageState())}
              onClick={() => dispatch({ type: "report.clicked" })}
            >
              {language.t(selectReported(pageState()) ? "error.page.action.reported" : "error.page.action.report")}
            </Button>
          </Show>
          <Show when={updater()}>
            <Show
              when={selectUpdateVersion(updater()?.state())}
              fallback={
                <Button
                  size="large"
                  variant="ghost"
                  onClick={() =>
                    dispatch({
                      type: "check.clicked",
                      available: !!updater(),
                      busy: isUpdaterBusy(updater()?.state()),
                    })
                  }
                  disabled={selectCheckUpdatesDisabled(pageState(), updater()?.state())}
                >
                  {selectCheckingUpdates(pageState(), updater()?.state())
                    ? language.t("error.page.action.checking")
                    : language.t("error.page.action.checkUpdates")}
                </Button>
              }
            >
              {(version) => (
                <Button
                  size="large"
                  disabled={selectInstallUpdateDisabled(pageState(), updater()?.state())}
                  onClick={() =>
                    dispatch({
                      type: "install.clicked",
                      available: !!updater(),
                      busy: updater()?.state()?.status === "installing",
                    })
                  }
                >
                  {language.t("error.page.action.updateTo", { version: version() })}
                </Button>
              )}
            </Show>
          </Show>
        </div>
        <Show when={selectActionError(pageState())}>
          {(message) => <p class="text-xs text-text-danger-base text-center max-w-2xl">{message()}</p>}
        </Show>
        <div class="flex flex-col items-center gap-2 text-xs text-center">
          <div class="flex flex-wrap items-center justify-center gap-1">
            {language.t("error.page.report.prefix")}
            <button
              type="button"
              class="flex items-center text-text-interactive-base gap-1"
              onClick={() => platform.openExternal("https://opencode.ai/desktop-feedback")}
            >
              <div>{language.t("error.page.report.discord")}</div>
              <Icon name="discord" class="text-text-interactive-base" />
            </button>
          </div>
          <Show when={platform.version}>
            {(version) => (
              <p class="text-xs text-text-weak">{language.t("error.page.version", { version: version() })}</p>
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
