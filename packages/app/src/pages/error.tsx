import { TextField } from "@opencode-ai/ui/text-field"
import { Logo } from "@opencode-ai/ui/logo"
import { Button } from "@opencode-ai/ui/button"
import { Component, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { Icon } from "@opencode-ai/ui/icon"

export type InitError = {
  name: string
  data: Record<string, unknown>
}

type Translator = ReturnType<typeof useLanguage>["t"]

function isInitError(error: unknown): error is InitError {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    "data" in error &&
    typeof (error as InitError).data === "object"
  )
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>()
  const json = JSON.stringify(
    value,
    (_key, val) => {
      if (typeof val === "bigint") return val.toString()
      if (typeof val === "object" && val) {
        if (seen.has(val)) return "[Circular]"
        seen.add(val)
      }
      return val
    },
    2,
  )
  return json ?? String(value)
}

function formatInitError(error: InitError, t: Translator): string {
  const data = error.data
  switch (error.name) {
    case "MCPFailed": {
      const name = typeof data.name === "string" ? data.name : ""
      return t("error.chain.mcpFailed", { name })
    }
    case "ProviderAuthError": {
      const providerID = typeof data.providerID === "string" ? data.providerID : "unknown"
      const message = typeof data.message === "string" ? data.message : safeJson(data.message)
      return t("error.chain.providerAuthFailed", { provider: providerID, message })
    }
    case "APIError": {
      const message = typeof data.message === "string" ? data.message : t("error.chain.apiError")
      const lines: string[] = [message]

      if (typeof data.statusCode === "number") {
        lines.push(t("error.chain.status", { status: data.statusCode }))
      }

      if (typeof data.isRetryable === "boolean") {
        lines.push(t("error.chain.retryable", { retryable: data.isRetryable }))
      }

      if (typeof data.responseBody === "string" && data.responseBody) {
        lines.push(t("error.chain.responseBody", { body: data.responseBody }))
      }

      return lines.join("\n")
    }
    case "ProviderModelNotFoundError": {
      const { providerID, modelID, suggestions } = data as {
        providerID: string
        modelID: string
        suggestions?: string[]
      }

      const suggestionsLine =
        Array.isArray(suggestions) && suggestions.length
          ? [t("error.chain.didYouMean", { suggestions: suggestions.join(", ") })]
          : []

      return [
        t("error.chain.modelNotFound", { provider: providerID, model: modelID }),
        ...suggestionsLine,
        t("error.chain.checkConfig"),
      ].join("\n")
    }
    case "ProviderInitError": {
      const providerID = typeof data.providerID === "string" ? data.providerID : "unknown"
      return t("error.chain.providerInitFailed", { provider: providerID })
    }
    case "ConfigJsonError": {
      const path = typeof data.path === "string" ? data.path : safeJson(data.path)
      const message = typeof data.message === "string" ? data.message : ""
      if (message) return t("error.chain.configJsonInvalidWithMessage", { path, message })
      return t("error.chain.configJsonInvalid", { path })
    }
    case "ConfigDirectoryTypoError": {
      const path = typeof data.path === "string" ? data.path : safeJson(data.path)
      const dir = typeof data.dir === "string" ? data.dir : safeJson(data.dir)
      const suggestion = typeof data.suggestion === "string" ? data.suggestion : safeJson(data.suggestion)
      return t("error.chain.configDirectoryTypo", { dir, path, suggestion })
    }
    case "ConfigFrontmatterError": {
      const path = typeof data.path === "string" ? data.path : safeJson(data.path)
      const message = typeof data.message === "string" ? data.message : safeJson(data.message)
      return t("error.chain.configFrontmatterError", { path, message })
    }
    case "ConfigInvalidError": {
      const issues = Array.isArray(data.issues)
        ? data.issues.map(
            (issue: { message: string; path: string[] }) => "↳ " + issue.message + " " + issue.path.join("."),
          )
        : []
      const message = typeof data.message === "string" ? data.message : ""
      const path = typeof data.path === "string" ? data.path : safeJson(data.path)

      const line = message
        ? t("error.chain.configInvalidWithMessage", { path, message })
        : t("error.chain.configInvalid", { path })

      return [line, ...issues].join("\n")
    }
    case "UnknownError":
      return typeof data.message === "string" ? data.message : safeJson(data)
    default:
      if (typeof data.message === "string") return data.message
      return safeJson(data)
  }
}

function formatErrorChain(error: unknown, t: Translator, depth = 0, parentMessage?: string): string {
  if (!error) return t("error.chain.unknown")

  if (isInitError(error)) {
    const message = formatInitError(error, t)
    if (depth > 0 && parentMessage === message) return ""
    const indent = depth > 0 ? `\n${"─".repeat(40)}\n${t("error.chain.causedBy")}\n` : ""
    return indent + `${error.name}\n${message}`
  }

  if (error instanceof Error) {
    const isDuplicate = depth > 0 && parentMessage === error.message
    const parts: string[] = []
    const indent = depth > 0 ? `\n${"─".repeat(40)}\n${t("error.chain.causedBy")}\n` : ""

    const header = `${error.name}${error.message ? `: ${error.message}` : ""}`
    const stack = error.stack?.trim()

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

    if (error.cause) {
      const causeResult = formatErrorChain(error.cause, t, depth + 1, error.message)
      if (causeResult) {
        parts.push(causeResult)
      }
    }

    return parts.join("\n\n")
  }

  if (typeof error === "string") {
    if (depth > 0 && parentMessage === error) return ""
    const indent = depth > 0 ? `\n${"─".repeat(40)}\n${t("error.chain.causedBy")}\n` : ""
    return indent + error
  }

  const indent = depth > 0 ? `\n${"─".repeat(40)}\n${t("error.chain.causedBy")}\n` : ""
  return indent + safeJson(error)
}

function formatError(error: unknown, t: Translator): string {
  return formatErrorChain(error, t, 0)
}

interface ErrorPageProps {
  error: unknown
}

export const ErrorPage: Component<ErrorPageProps> = (props) => {
  const platform = usePlatform()
  const language = useLanguage()
  const [store, setStore] = createStore({
    checking: false,
    version: undefined as string | undefined,
  })

  async function checkForUpdates() {
    if (!platform.checkUpdate) return
    setStore("checking", true)
    const result = await platform.checkUpdate()
    setStore("checking", false)
    if (result.updateAvailable && result.version) setStore("version", result.version)
  }

  async function installUpdate() {
    if (!platform.update || !platform.restart) return
    await platform.update()
    await platform.restart()
  }

  return (
    <div class="relative flex-1 h-screen w-screen min-h-0 flex flex-col items-center justify-center bg-background-base font-sans">
      <div class="w-2/3 max-w-3xl flex flex-col items-center justify-center gap-8">
        <Logo class="w-58.5 opacity-12 shrink-0" />
        <div class="flex flex-col items-center gap-2 text-center">
          <h1 class="text-lg font-medium text-text-strong">{language.t("error.page.title")}</h1>
          <p class="text-sm text-text-weak">{language.t("error.page.description")}</p>
        </div>
        <TextField
          value={formatError(props.error, language.t)}
          readOnly
          copyable
          multiline
          class="max-h-96 w-full font-mono text-xs no-scrollbar"
          label={language.t("error.page.details.label")}
          hideLabel
        />
        <div class="flex items-center gap-3">
          <Button size="large" onClick={platform.restart}>
            {language.t("error.page.action.restart")}
          </Button>
          <Show when={platform.checkUpdate}>
            <Show
              when={store.version}
              fallback={
                <Button size="large" variant="ghost" onClick={checkForUpdates} disabled={store.checking}>
                  {store.checking
                    ? language.t("error.page.action.checking")
                    : language.t("error.page.action.checkUpdates")}
                </Button>
              }
            >
              <Button size="large" onClick={installUpdate}>
                {language.t("error.page.action.updateTo", { version: store.version ?? "" })}
              </Button>
            </Show>
          </Show>
        </div>
        <div class="flex flex-col items-center gap-2">
          <div class="flex items-center justify-center gap-1">
            {language.t("error.page.report.prefix")}
            <button
              type="button"
              class="flex items-center text-text-interactive-base gap-1"
              onClick={() => platform.openLink("https://opencode.ai/desktop-feedback")}
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
