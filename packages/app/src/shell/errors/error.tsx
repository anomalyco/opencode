import { TextField } from "@opencode/ui/text-field"
import type { captureException } from "@sentry/solid"
import { Logo } from "@opencode/ui/logo"
import { Button } from "@opencode/ui/button"
import { Component, createSignal, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Predicate } from "effect"
import { Updater } from "@opencode/gui-extensions/updater"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"
import { createIpcClients } from "@/runtime/extension/ipc"
import { Icon } from "@opencode/ui/icon"
import { errorDescriptionKey, errorPortConflict, errorPortConflictDetails, errorStatus } from "./description"

export type InitError = {
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
  const formattedError = () => errorPortConflictDetails(props.error) ?? formatError(props.error, language.t)
  const status = () => errorStatus(props.error)
  const conflictPort = () => (platform.setLocalServerPort ? errorPortConflict(props.error) : undefined)
  let recordedFatalError: Promise<void> | undefined

  const [store, setStore] = createStore<{
    actionError: string | undefined
    captureException: typeof captureException | undefined
    port: string
    savingPort: boolean
    portError: boolean
  }>({
    actionError: undefined,
    captureException: undefined,
    port: "",
    savingPort: false,
    portError: false,
  })

  function ensureFatalErrorRecorded() {
    recordedFatalError ??=
      platform.recordFatalRendererError?.({
        error: formattedError(),
        url: location.href,
        version: platform.version,
        platform: platform.platform,
        os: platform.os,
      }) ?? Promise.resolve()

    return recordedFatalError
  }

  onMount(() => {
    void ensureFatalErrorRecorded().catch(() => undefined)
    void import("@sentry/solid")
      .then(({ captureException, isEnabled }) => {
        if (isEnabled()) setStore("captureException", () => captureException)
      })
      .catch(() => undefined)
  })

  // A crash can take the extension root down with the app, so the page reaches the updater's
  // main-process Ipc over the bridge itself.
  const ipcs = createIpcClients(platform.extensions)
  onCleanup(ipcs.dispose)
  const updater = () => ipcs.typed(Updater)

  async function checkForUpdates() {
    const state = await updater()?.check()
    setStore("actionError", state?.status === "error" ? state.message : undefined)
  }

  async function installUpdate() {
    await updater()
      ?.install()
      .then(() => setStore("actionError", undefined))
      .catch((err) => {
        setStore("actionError", formatError(err, language.t))
      })
  }

  const updateVersion = () => {
    const state = updater()?.state()

    return state?.status === "ready" || state?.status === "download-required" ? state.version : undefined
  }

  async function exportDebugLogs() {
    const exportLogs = platform.exportDebugLogs

    if (!exportLogs) return
    await ensureFatalErrorRecorded()
      .then(() => exportLogs())
      .then(() => setStore("actionError", undefined))
      .catch((err) => {
        setStore("actionError", formatError(err, language.t))
      })
  }

  async function savePort() {
    if (store.savingPort || !platform.setLocalServerPort) return

    const port = Number(store.port)

    if (!/^\d+$/.test(store.port) || !Number.isInteger(port) || port < 1 || port > 65535 || port === conflictPort()) {
      setStore("portError", true)

      return
    }

    setStore({ savingPort: true, portError: false, actionError: undefined })
    await platform
      .setLocalServerPort(port)
      .then(() => platform.restart())
      .catch((error) => setStore("actionError", formatError(error, language.t)))
    setStore("savingPort", false)
  }

  return (
    <div
      class="relative flex-1 h-full w-full min-h-0 min-w-0 overflow-y-auto flex flex-col items-center justify-start sm:justify-center p-4 sm:p-8 font-sans"
      data-tauri-drag-region
    >
      <div class="w-full max-w-3xl flex flex-col items-center justify-center gap-6 sm:gap-8 my-auto">
        <Logo class="w-48 sm:w-58.5 opacity-12 shrink-0" />
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">
            {language.t(
              conflictPort()
                ? "error.page.title.portConflict"
                : status()
                  ? "error.page.title.status"
                  : "error.page.title",
            )}
          </h1>
          <p class="text-sm text-text-weak">
            {conflictPort()
              ? language.t("error.page.description.portConflict", { port: conflictPort()! })
              : status()
                ? language.t("error.page.description.status", { status: status()! })
                : language.t(errorDescriptionKey(props.error))}
          </p>
        </div>
        <TextField
          value={formattedError()}
          readOnly
          copyable
          multiline
          dir={conflictPort() ? "ltr" : undefined}
          class="max-h-96 w-full font-mono text-xs no-scrollbar"
          label={language.t("error.page.details.label")}
          hideLabel
        />
        <Show when={conflictPort()}>
          <form
            class="w-full max-w-sm flex flex-col gap-3 [app-region:no-drag]"
            onSubmit={(event) => {
              event.preventDefault()
              void savePort()
            }}
          >
            <TextField
              label={language.t("error.page.port.label")}
              value={store.port}
              onChange={(port) => setStore({ port, portError: false })}
              inputMode="numeric"
              dir="ltr"
              required
              disabled={store.savingPort}
              validationState={store.portError ? "invalid" : "valid"}
              error={store.portError ? language.t("error.page.port.invalid") : undefined}
            />
            <Button type="submit" size="large" disabled={store.savingPort}>
              {language.t(store.savingPort ? "error.page.action.savingPort" : "error.page.action.savePort")}
            </Button>
          </form>
        </Show>
        <div class="flex flex-row items-center justify-center gap-3 flex-wrap max-w-64">
          <Button size="large" onClick={platform.restart} disabled={store.savingPort}>
            {language.t(platform.platform === "web" ? "error.page.action.reload" : "error.page.action.restart")}
          </Button>
          <Show when={platform.platform === "desktop" && platform.exportDebugLogs}>
            <Button size="large" variant="ghost" onClick={exportDebugLogs}>
              {language.t("error.page.action.exportLogs")}
            </Button>
          </Show>
          <Show when={store.captureException}>
            {(capture) => {
              const [reported, setReported] = createSignal(false)

              return (
                <Button
                  size="large"
                  disabled={reported()}
                  onClick={() => {
                    capture()(props.error)
                    setReported(true)
                  }}
                >
                  {language.t(reported() ? "error.page.action.reported" : "error.page.action.report")}
                </Button>
              )
            }}
          </Show>
          <Show when={updater()}>
            <Show
              when={updateVersion()}
              fallback={
                <Button
                  size="large"
                  variant="ghost"
                  onClick={checkForUpdates}
                  disabled={["checking", "downloading", "installing"].includes(updater()?.state()?.status ?? "")}
                >
                  {updater()?.state()?.status === "checking"
                    ? language.t("error.page.action.checking")
                    : language.t("error.page.action.checkUpdates")}
                </Button>
              }
            >
              {(version) => (
                <Button size="large" onClick={installUpdate}>
                  {language.t("error.page.action.updateTo", { version: version() })}
                </Button>
              )}
            </Show>
          </Show>
        </div>
        <Show when={store.actionError}>
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
