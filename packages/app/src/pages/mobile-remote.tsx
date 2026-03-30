import type {
  AssistantMessage,
  FilePart,
  Message,
  Part,
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
  ReasoningPart,
  SessionStatus,
  TextPart,
  ToolPart,
} from "@opencode-ai/sdk/v2/client"
import { toDataURL } from "qrcode"
import { useNavigate, useParams } from "@solidjs/router"
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js"
import { createStore } from "solid-js/store"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useSync } from "@/context/sync"

type MessageEntry = {
  info: Message
  parts: Part[]
}

type LiveLogEntry = {
  id: string
  time: number
  level: "DEBUG" | "INFO" | "WARN" | "ERROR"
  service: string
  message: string
  extra?: Record<string, unknown>
}

type RemoteStandalonePairing = {
  token: string
  expiresAt: number
  directory: string
  sessionID?: string
  url: string
}

const LOG_LIMIT = 200

function extractText(parts: Part[]) {
  const text = parts
    .filter((part): part is TextPart => part.type === "text")
    .filter((part) => !part.synthetic && !part.ignored)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")

  if (text) return text
  if (parts.some((part) => part.type === "reasoning")) return "[reasoning]"
  if (parts.some((part) => part.type === "tool")) return "[tool activity]"
  if (parts.some((part) => part.type === "file")) return "[file context]"
  if (parts.some((part) => part.type === "agent")) return "[agent handoff]"
  return "[no text content]"
}

function shorten(value: string, max = 220) {
  if (value.length <= max) return value
  return value.slice(0, max - 1).trimEnd() + "…"
}

function formatTimestamp(timestamp?: number) {
  if (!timestamp) return ""
  return new Date(timestamp).toLocaleString()
}

function formatCurrency(value?: number) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return "—"
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: numeric >= 10 ? 2 : 3,
  }).format(numeric)
}

function formatCompactCount(value?: number) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return "0"
  if (numeric < 1_000) return `${numeric}`
  if (numeric < 10_000) return `${(numeric / 1_000).toFixed(1)}K`
  if (numeric < 1_000_000) return `${Math.round(numeric / 100) / 10}K`
  return `${Math.round(numeric / 100_000) / 10}M`
}

function formatStructured(value: unknown) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatError(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { message?: string } }).data
    if (data?.message) return data.message
  }
  if (error instanceof Error && error.message) return error.message
  return "Request failed"
}

function logLevelTone(level: LiveLogEntry["level"]) {
  if (level === "ERROR") return "bg-status-error-subtle text-status-error-base"
  if (level === "WARN") return "bg-status-warning-subtle text-status-warning-base"
  if (level === "DEBUG") return "bg-surface-raised text-text-weak"
  return "bg-accent-subtle text-accent-base"
}

function logConnectionTone(status: "connecting" | "live" | "reconnecting" | "offline") {
  if (status === "live") return "bg-accent-subtle text-accent-base"
  if (status === "reconnecting") return "bg-status-warning-subtle text-status-warning-base"
  if (status === "offline") return "bg-status-error-subtle text-status-error-base"
  return "bg-surface-raised text-text-base"
}

function logConnectionLabel(status: "connecting" | "live" | "reconnecting" | "offline") {
  if (status === "live") return "Live"
  if (status === "reconnecting") return "Reconnecting"
  if (status === "offline") return "Offline"
  return "Connecting"
}

function buildAbsoluteUrl(base: string | undefined, path: string) {
  if (!base) return

  try {
    const parsed = new URL(base)
    if (!["http:", "https:"].includes(parsed.protocol)) return
    return new URL(path, parsed).toString()
  } catch {
    return
  }
}

function buildSocketUrl(
  base: string | undefined,
  path: string,
  auth?: { username?: string; password?: string },
  query?: Record<string, string | number | undefined>,
) {
  const absolute = buildAbsoluteUrl(base, path)
  if (!absolute) return

  try {
    const parsed = new URL(absolute)
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:"
    if (auth?.username) parsed.username = auth.username
    if (auth?.password) parsed.password = auth.password

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === "") continue
      parsed.searchParams.set(key, String(value))
    }

    return parsed.toString()
  } catch {
    return
  }
}

function buildBasicAuthHeader(auth?: { username?: string; password?: string }) {
  if (!auth?.username && !auth?.password) return
  if (typeof btoa !== "function") return
  return `Basic ${btoa(`${auth?.username ?? "opencode"}:${auth?.password ?? ""}`)}`
}

function buildRemoteStandaloneUrl(base: string | undefined, input: { directory?: string; sessionID?: string }) {
  const absolute = buildAbsoluteUrl(base, "/remote")
  if (!absolute) return

  try {
    const parsed = new URL(absolute)
    if (input.directory) parsed.searchParams.set("directory", input.directory)
    if (input.sessionID) parsed.searchParams.set("sessionID", input.sessionID)
    return parsed.toString()
  } catch {
    return
  }
}

async function createRemoteStandalonePairing(
  base: string | undefined,
  auth: { username?: string; password?: string } | undefined,
  input: { directory?: string; sessionID?: string },
) {
  const absolute = buildAbsoluteUrl(base, "/remote/pair")
  if (!absolute || !input.directory) return

  const headers = new Headers({
    "Content-Type": "application/json",
  })
  const basicAuth = buildBasicAuthHeader(auth)
  if (basicAuth) headers.set("Authorization", basicAuth)

  const response = await fetch(absolute, {
    method: "POST",
    headers,
    body: JSON.stringify({
      directory: input.directory,
      sessionID: input.sessionID,
    }),
  })

  const payload = (await response.json().catch(() => null)) as RemoteStandalonePairing | { data?: { message?: string } } | null
  if (!response.ok) {
    throw new Error(errorMessageFromPairing(payload, response.statusText))
  }

  return payload as RemoteStandalonePairing
}

function errorMessageFromPairing(
  payload: RemoteStandalonePairing | { data?: { message?: string } } | null,
  fallback: string,
) {
  if (payload && typeof payload === "object" && "data" in payload) {
    if (payload.data?.message) return payload.data.message
  }
  return fallback || "Could not create secure standalone link"
}

async function copyText(value: string) {
  const body = typeof document === "undefined" ? undefined : document.body
  if (body) {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.opacity = "0"
    textarea.style.pointerEvents = "none"
    body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand("copy")
    body.removeChild(textarea)
    if (copied) return true
  }

  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
  if (!clipboard?.writeText) return false

  try {
    await clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

async function shareLink(input: { title: string; text: string; url: string }) {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false

  try {
    await navigator.share(input)
    return true
  } catch {
    return false
  }
}

function permissionLabel(request: PermissionRequest) {
  const filepath = typeof request.metadata?.filepath === "string" ? request.metadata.filepath : ""
  const command = typeof request.metadata?.command === "string" ? request.metadata.command : ""
  const pattern = typeof request.metadata?.pattern === "string" ? request.metadata.pattern : ""

  if (filepath) return `${request.permission} • ${filepath}`
  if (command) return `${request.permission} • ${command}`
  if (pattern) return `${request.permission} • ${pattern}`
  if (request.patterns.length > 0) return `${request.permission} • ${request.patterns.join(", ")}`
  return request.permission
}

function sessionStatusLabel(status?: SessionStatus) {
  if (!status || status.type === "idle") return "Idle"
  if (status.type === "busy") return "Busy"
  return `Retry ${status.attempt}`
}

function sessionStatusTone(status?: SessionStatus) {
  if (!status || status.type === "idle") return "bg-surface-raised text-text-base"
  if (status.type === "busy") return "bg-accent-subtle text-accent-base"
  return "bg-status-warning-subtle text-status-warning-base"
}

function messageRoleLabel(role: Message["role"]) {
  if (role === "assistant") return "Agent"
  if (role === "user") return "You"
  return role
}

function isAssistantMessage(message: Message): message is AssistantMessage {
  return message.role === "assistant"
}

function toolStatusLabel(part: ToolPart) {
  if (part.state.status === "running") return part.state.title || "Running"
  if (part.state.status === "completed") return part.state.title || "Completed"
  if (part.state.status === "error") return "Failed"
  return "Pending"
}

function toolStatusTone(part: ToolPart) {
  if (part.state.status === "completed") return "bg-accent-subtle text-accent-base"
  if (part.state.status === "error") return "bg-status-error-subtle text-status-error-base"
  if (part.state.status === "running") return "bg-status-warning-subtle text-status-warning-base"
  return "bg-surface-raised text-text-base"
}

function hasRenderableText(parts: Part[]) {
  return parts.some((part) => part.type === "text" && !part.synthetic && !part.ignored && part.text.trim())
}

function MessageCard(props: { entry: MessageEntry }) {
  const textParts = createMemo(() =>
    props.entry.parts.filter((part): part is TextPart => part.type === "text" && !part.synthetic && !part.ignored),
  )
  const reasoningParts = createMemo(() => props.entry.parts.filter((part): part is ReasoningPart => part.type === "reasoning"))
  const toolParts = createMemo(() => props.entry.parts.filter((part): part is ToolPart => part.type === "tool"))
  const fileParts = createMemo(() => props.entry.parts.filter((part): part is FilePart => part.type === "file"))
  const otherParts = createMemo(() =>
    props.entry.parts.filter((part) => !["text", "reasoning", "tool", "file"].includes(part.type)),
  )
  const assistantMeta = createMemo(() =>
    isAssistantMessage(props.entry.info)
      ? `${props.entry.info.providerID} · ${props.entry.info.modelID}`
      : undefined,
  )

  return (
    <article class="rounded-xl border border-border-default bg-background-base px-4 py-3 flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-12-medium uppercase tracking-wide text-text-weak">{messageRoleLabel(props.entry.info.role)}</span>
          <Show when={assistantMeta()}>
            {(meta) => <span class="rounded-full bg-surface-raised px-2 py-0.5 text-11-regular text-text-weak">{meta()}</span>}
          </Show>
        </div>
        <span class="text-11-regular text-text-weak">{formatTimestamp(props.entry.info.time.created)}</span>
      </div>

      <Show
        when={textParts().length > 0}
        fallback={
          <div class="rounded-lg border border-dashed border-border-default px-3 py-3 text-12-regular text-text-weak">
            {extractText(props.entry.parts)}
          </div>
        }
      >
        <div class="flex flex-col gap-3">
          <For each={textParts()}>
            {(part) => (
              <pre class="whitespace-pre-wrap break-words text-13-regular text-text-base font-sans">{part.text.trim()}</pre>
            )}
          </For>
        </div>
      </Show>

      <Show when={reasoningParts().length > 0}>
        <details class="rounded-lg border border-border-default bg-surface-base">
          <summary class="cursor-pointer px-3 py-2 text-12-medium text-text-strong">
            Reasoning ({reasoningParts().length})
          </summary>
          <div class="px-3 pb-3 flex flex-col gap-2">
            <For each={reasoningParts()}>
              {(part) => (
                <pre class="whitespace-pre-wrap break-words rounded-lg bg-background-base px-3 py-2 text-12-regular text-text-base font-sans">
                  {part.text.trim() || "[empty reasoning]"}
                </pre>
              )}
            </For>
          </div>
        </details>
      </Show>

      <Show when={toolParts().length > 0}>
        <details class="rounded-lg border border-border-default bg-surface-base">
          <summary class="cursor-pointer px-3 py-2 text-12-medium text-text-strong">
            Tool activity ({toolParts().length})
          </summary>
          <div class="px-3 pb-3 flex flex-col gap-3">
            <For each={toolParts()}>
              {(part) => (
                <div class="rounded-lg border border-border-default bg-background-base px-3 py-3 flex flex-col gap-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <div class="text-12-medium text-text-strong">{part.tool}</div>
                    <div class={`rounded-full px-2 py-0.5 text-11-medium ${toolStatusTone(part)}`}>{toolStatusLabel(part)}</div>
                  </div>
                  <Show when={part.state.status !== "pending"}>
                    <div class="text-11-regular text-text-weak">Status: {part.state.status}</div>
                  </Show>
                  <pre class="max-h-48 overflow-auto rounded-lg bg-surface-raised px-3 py-2 whitespace-pre-wrap break-words text-11-regular text-text-base font-mono">
                    {formatStructured(part.state.input)}
                  </pre>
                  <Show when={part.state.status === "completed"}>
                    <pre class="max-h-48 overflow-auto rounded-lg bg-surface-raised px-3 py-2 whitespace-pre-wrap break-words text-11-regular text-text-base font-mono">
                      {part.state.status === "completed" ? part.state.output : ""}
                    </pre>
                  </Show>
                  <Show when={part.state.status === "error"}>
                    <div class="rounded-lg border border-status-error-base bg-status-error-subtle px-3 py-2 text-11-regular text-status-error-base">
                      {part.state.status === "error" ? part.state.error : ""}
                    </div>
                  </Show>
                  <Show when={part.state.status === "completed" && (part.state.attachments?.length ?? 0) > 0}>
                    <div class="text-11-regular text-text-weak">
                      Attachments:{" "}
                      {part.state.status === "completed"
                        ? part.state.attachments?.map((item) => item.filename || item.url).join(", ")
                        : ""}
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </details>
      </Show>

      <Show when={fileParts().length > 0}>
        <details class="rounded-lg border border-border-default bg-surface-base">
          <summary class="cursor-pointer px-3 py-2 text-12-medium text-text-strong">Files ({fileParts().length})</summary>
          <div class="px-3 pb-3 flex flex-col gap-2">
            <For each={fileParts()}>
              {(part) => (
                <div class="rounded-lg border border-border-default bg-background-base px-3 py-2 text-11-regular text-text-base break-words">
                  <div class="text-12-medium text-text-strong">{part.filename || part.source?.type || "File attachment"}</div>
                  <div class="mt-1 text-text-weak">{part.source?.type === "file" ? part.source.path : part.url}</div>
                </div>
              )}
            </For>
          </div>
        </details>
      </Show>

      <Show when={otherParts().length > 0}>
        <div class="flex flex-wrap gap-2">
          <For each={otherParts()}>
            {(part) => (
              <span class="rounded-full border border-border-default bg-surface-raised px-2 py-1 text-11-regular text-text-weak">
                {part.type}
              </span>
            )}
          </For>
        </div>
      </Show>
    </article>
  )
}

function SessionBadge(props: { sessionTitle?: string; sessionID: string }) {
  return (
    <div class="text-11-regular text-text-weak">
      {props.sessionTitle ?? "Untitled session"} · {shorten(props.sessionID, 16)}
    </div>
  )
}

function PairingQr(props: { url: string; label: string }) {
  const [image] = createResource(
    () => (typeof window === "undefined" ? undefined : props.url),
    async (url) =>
      await toDataURL(url, {
        width: 224,
        margin: 1,
        color: {
          dark: "#111827ff",
          light: "#ffffffff",
        },
      }),
  )

  return (
    <div class="rounded-xl border border-border-default bg-surface-base px-4 py-4 flex flex-col items-center gap-3">
      <div class="text-12-medium text-text-strong">Scan {props.label}</div>
      <Switch>
        <Match when={image.loading}>
          <div class="size-56 rounded-lg border border-dashed border-border-default flex items-center justify-center text-12-regular text-text-weak">
            Generating QR…
          </div>
        </Match>
        <Match when={image.error}>
          <div class="size-56 rounded-lg border border-status-error-base bg-status-error-subtle flex items-center justify-center px-4 text-center text-12-regular text-status-error-base">
            QR unavailable
          </div>
        </Match>
        <Match when={image()}>
          {(src) => (
            <img
              src={src()}
              alt={`QR for ${props.label}`}
              class="size-56 rounded-lg border border-border-default bg-white object-contain"
            />
          )}
        </Match>
      </Switch>
      <div class="text-center text-11-regular text-text-weak">Open your phone camera and scan this code.</div>
    </div>
  )
}

function LogCard(props: { entry: LiveLogEntry }) {
  return (
    <article class="rounded-xl border border-border-default bg-background-base px-4 py-3 flex flex-col gap-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class={`rounded-full px-2.5 py-1 text-11-medium ${logLevelTone(props.entry.level)}`}>
            {props.entry.level}
          </span>
          <span class="rounded-full bg-surface-raised px-2.5 py-1 text-11-regular text-text-weak">{props.entry.service}</span>
        </div>
        <span class="text-11-regular text-text-weak">{formatTimestamp(props.entry.time)}</span>
      </div>

      <pre class="whitespace-pre-wrap break-words text-12-regular text-text-base font-mono">{props.entry.message}</pre>

      <Show when={props.entry.extra && Object.keys(props.entry.extra).length > 0}>
        <details class="rounded-lg border border-border-default bg-surface-base">
          <summary class="cursor-pointer px-3 py-2 text-12-medium text-text-strong">Metadata</summary>
          <pre class="max-h-48 overflow-auto px-3 pb-3 whitespace-pre-wrap break-words text-11-regular text-text-base font-mono">
            {formatStructured(props.entry.extra)}
          </pre>
        </details>
      </Show>
    </article>
  )
}

function PermissionCard(props: {
  request: PermissionRequest
  sessionTitle?: string
  onHandled: () => Promise<unknown>
}) {
  const sdk = useSDK()
  const [busy, setBusy] = createSignal<"once" | "always" | "reject">()
  const [error, setError] = createSignal<string>()

  const filepath = createMemo(() =>
    typeof props.request.metadata?.filepath === "string" ? props.request.metadata.filepath : "",
  )
  const command = createMemo(() =>
    typeof props.request.metadata?.command === "string" ? props.request.metadata.command : "",
  )
  const pattern = createMemo(() =>
    typeof props.request.metadata?.pattern === "string" ? props.request.metadata.pattern : "",
  )
  const diff = createMemo(() => (typeof props.request.metadata?.diff === "string" ? props.request.metadata.diff : ""))

  const reply = async (action: "once" | "always" | "reject") => {
    if (busy()) return

    setBusy(action)
    setError(undefined)
    try {
      await sdk.client.permission.reply({
        requestID: props.request.id,
        reply: action,
      })
      await props.onHandled()
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <article class="rounded-xl border border-border-default bg-background-base px-4 py-3 flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-13-medium text-text-strong">Permission request</div>
          <div class="mt-1 text-12-regular text-text-base break-words">{permissionLabel(props.request)}</div>
        </div>
        <div class="rounded-full bg-status-warning-subtle px-2.5 py-1 text-11-medium text-status-warning-base">
          Approval
        </div>
      </div>

      <SessionBadge sessionID={props.request.sessionID} sessionTitle={props.sessionTitle} />

      <Show when={filepath()}>
        <div class="text-12-regular text-text-weak break-all">Path: {filepath()}</div>
      </Show>
      <Show when={command()}>
        <div class="text-12-regular text-text-weak break-all">Command: {command()}</div>
      </Show>
      <Show when={pattern()}>
        <div class="text-12-regular text-text-weak break-all">Pattern: {pattern()}</div>
      </Show>
      <Show when={props.request.patterns.length > 0}>
        <div class="text-12-regular text-text-weak break-words">Always patterns: {props.request.patterns.join(", ")}</div>
      </Show>
      <Show when={diff()}>
        <pre class="max-h-48 overflow-auto rounded-lg bg-surface-raised px-3 py-2 whitespace-pre-wrap break-words text-11-regular text-text-base font-mono">
          {shorten(diff(), 1200)}
        </pre>
      </Show>

      <Show when={error()}>
        {(message) => (
          <div class="rounded-lg border border-status-error-base bg-status-error-subtle px-3 py-2 text-12-regular text-status-error-base">
            {message()}
          </div>
        )}
      </Show>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          type="button"
          class="rounded-lg bg-accent-base px-3 py-2 text-12-medium text-white disabled:opacity-50"
          disabled={!!busy()}
          onClick={() => void reply("once")}
        >
          {busy() === "once" ? "Allowing…" : "Allow once"}
        </button>
        <button
          type="button"
          class="rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-12-medium disabled:opacity-50"
          disabled={!!busy()}
          onClick={() => void reply("always")}
        >
          {busy() === "always" ? "Saving…" : "Always allow"}
        </button>
        <button
          type="button"
          class="rounded-lg border border-status-error-base bg-status-error-subtle px-3 py-2 text-12-medium text-status-error-base disabled:opacity-50"
          disabled={!!busy()}
          onClick={() => void reply("reject")}
        >
          {busy() === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </article>
  )
}

function QuestionCard(props: {
  request: QuestionRequest
  sessionTitle?: string
  onHandled: () => Promise<unknown>
}) {
  const sdk = useSDK()
  const [answers, setAnswers] = createStore<QuestionAnswer[]>(props.request.questions.map(() => []))
  const [custom, setCustom] = createStore<string[]>(props.request.questions.map(() => ""))
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const canSubmit = createMemo(() => props.request.questions.every((_, index) => (answers[index] ?? []).length > 0))

  const setSingleAnswer = (index: number, value: string) => {
    setCustom(index, "")
    setAnswers(index, [value])
  }

  const toggleMultiAnswer = (index: number, value: string) => {
    setAnswers(index, (current = []) => {
      if (current.includes(value)) return current.filter((item) => item !== value)
      return [...current, value]
    })
  }

  const updateCustom = (index: number, value: string, multiple: boolean) => {
    const trimmed = value.trim()
    const previous = (custom[index] ?? "").trim()
    setCustom(index, value)

    if (!multiple) {
      setAnswers(index, trimmed ? [trimmed] : [])
      return
    }

    setAnswers(index, (current = []) => {
      const removed = previous ? current.filter((item) => item.trim() !== previous) : current
      if (!trimmed) return removed
      if (removed.some((item) => item.trim() === trimmed)) return removed
      return [...removed, trimmed]
    })
  }

  const submit = async () => {
    if (busy()) return

    const normalized = props.request.questions.map((question, index) => {
      const values = [...new Set((answers[index] ?? []).map((item) => item.trim()).filter(Boolean))]
      if (question.multiple) return values
      return values[0] ? [values[0]] : []
    })

    if (normalized.some((answer) => answer.length === 0)) {
      setError("Answer every question before submitting.")
      return
    }

    setBusy(true)
    setError(undefined)
    try {
      await sdk.client.question.reply({
        requestID: props.request.id,
        answers: normalized,
      })
      await props.onHandled()
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusy(false)
    }
  }

  const reject = async () => {
    if (busy()) return
    setBusy(true)
    setError(undefined)
    try {
      await sdk.client.question.reject({
        requestID: props.request.id,
      })
      await props.onHandled()
    } catch (cause) {
      setError(formatError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article class="rounded-xl border border-border-default bg-background-base px-4 py-3 flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-13-medium text-text-strong">Question request</div>
          <div class="mt-1 text-12-regular text-text-weak">{props.request.questions.length} prompt(s) awaiting reply</div>
        </div>
        <div class="rounded-full bg-accent-subtle px-2.5 py-1 text-11-medium text-accent-base">Question</div>
      </div>

      <SessionBadge sessionID={props.request.sessionID} sessionTitle={props.sessionTitle} />

      <div class="flex flex-col gap-4">
        <For each={props.request.questions}>
          {(question, index) => {
            const answer = createMemo(() => answers[index()] ?? [])
            const customValue = createMemo(() => custom[index()] ?? "")
            return (
              <section class="rounded-lg border border-border-default bg-surface-base px-3 py-3 flex flex-col gap-3">
                <div>
                  <div class="text-12-medium text-text-strong">{question.header}</div>
                  <div class="mt-1 text-12-regular text-text-base whitespace-pre-wrap">{question.question}</div>
                </div>

                <div class="flex flex-wrap gap-2">
                  <For each={question.options}>
                    {(option) => {
                      const selected = createMemo(() => answer().includes(option.label))
                      return (
                        <button
                          type="button"
                          class="rounded-full border px-3 py-1.5 text-12-medium transition-colors"
                          classList={{
                            "border-accent-base bg-accent-subtle text-accent-base": selected(),
                            "border-border-default bg-background-base text-text-base": !selected(),
                          }}
                          disabled={busy()}
                          onClick={() => {
                            if (question.multiple) {
                              toggleMultiAnswer(index(), option.label)
                              return
                            }
                            setSingleAnswer(index(), option.label)
                          }}
                        >
                          {option.label}
                        </button>
                      )
                    }}
                  </For>
                </div>

                <Show when={question.custom !== false}>
                  <div class="flex flex-col gap-2">
                    <label class="text-11-medium text-text-weak">Custom answer</label>
                    <textarea
                      class="min-h-20 w-full resize-y rounded-lg border border-border-default bg-background-base px-3 py-2 text-12-regular text-text-base outline-none"
                      placeholder={question.multiple ? "Add another answer" : "Write your answer"}
                      value={customValue()}
                      onInput={(event) => updateCustom(index(), event.currentTarget.value, question.multiple === true)}
                    />
                  </div>
                </Show>
              </section>
            )
          }}
        </For>
      </div>

      <Show when={error()}>
        {(message) => (
          <div class="rounded-lg border border-status-error-base bg-status-error-subtle px-3 py-2 text-12-regular text-status-error-base">
            {message()}
          </div>
        )}
      </Show>

      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-center">
        <div class="text-11-regular text-text-weak">
          {canSubmit() ? "Ready to reply." : "Select or type an answer for every question."}
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class="rounded-lg border border-status-error-base bg-status-error-subtle px-3 py-2 text-12-medium text-status-error-base disabled:opacity-50"
            disabled={busy()}
            onClick={() => void reject()}
          >
            {busy() ? "Working…" : "Reject"}
          </button>
          <button
            type="button"
            class="rounded-lg bg-accent-base px-3 py-2 text-12-medium text-white disabled:opacity-50"
            disabled={busy() || !canSubmit()}
            onClick={() => void submit()}
          >
            {busy() ? "Sending…" : "Reply"}
          </button>
        </div>
      </div>
    </article>
  )
}

export default function MobileRemotePage() {
  const sdk = useSDK()
  const server = useServer()
  const sync = useSync()
  const params = useParams()
  const navigate = useNavigate()

  const [composer, setComposer] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [shareMode, setShareMode] = createSignal<"workspace" | "session">("workspace")
  const [pairingBusy, setPairingBusy] = createSignal<string>()
  const [pairingMessage, setPairingMessage] = createSignal<string>()
  const [pairingError, setPairingError] = createSignal<string>()
  const [autoScroll, setAutoScroll] = createSignal(true)
  const [unseenMessages, setUnseenMessages] = createSignal(0)
  const [logs, setLogs] = createSignal<LiveLogEntry[]>([])
  const [knownServices, setKnownServices] = createSignal<string[]>([])
  const [serviceFilter, setServiceFilter] = createSignal("")
  const [levelFilter, setLevelFilter] = createSignal<"" | LiveLogEntry["level"]>("")
  const [logScope, setLogScope] = createSignal<"workspace" | "session">("workspace")
  const [logsLoading, setLogsLoading] = createSignal(false)
  const [logsError, setLogsError] = createSignal<string>()
  const [logsConnection, setLogsConnection] = createSignal<"connecting" | "live" | "reconnecting" | "offline">(
    "connecting",
  )
  const [logAutoScroll, setLogAutoScroll] = createSignal(true)
  const [unseenLogs, setUnseenLogs] = createSignal(0)

  let messageViewport: HTMLDivElement | undefined
  let logViewport: HTMLDivElement | undefined

  const currentSessionID = createMemo(() => params.id)
  const currentRouteBase = createMemo(() => `/${params.dir}/remote`)
  const activeShareMode = createMemo(() => {
    if (shareMode() === "session" && currentSessionID()) return "session" as const
    return "workspace" as const
  })
  const pairingPath = createMemo(() =>
    activeShareMode() === "session" && currentSessionID()
      ? `${currentRouteBase()}/${currentSessionID()}`
      : currentRouteBase(),
  )
  const browserPairUrl = createMemo(() =>
    typeof window === "undefined" ? undefined : buildAbsoluteUrl(window.location.origin, pairingPath()),
  )
  const serverPairUrl = createMemo(() => buildAbsoluteUrl(sdk.url, pairingPath()))
  const directStandalonePairUrl = createMemo(() =>
    buildRemoteStandaloneUrl(sdk.url, {
      directory: sdk.directory,
      sessionID: activeShareMode() === "session" ? currentSessionID() : undefined,
    }),
  )
  const [standalonePairing, standalonePairingActions] = createResource(
    () => ({
      base: sdk.url,
      directory: sdk.directory,
      sessionID: activeShareMode() === "session" ? currentSessionID() : undefined,
      auth: server.current?.http,
    }),
    async (input) =>
      await createRemoteStandalonePairing(input.base, input.auth, {
        directory: input.directory,
        sessionID: input.sessionID,
      }),
  )
  const standalonePairUrl = createMemo(() => standalonePairing()?.url ?? directStandalonePairUrl())
  const standalonePairDescription = createMemo(() => {
    if (standalonePairing.loading) return "Generating temporary secure standalone link…"
    if (standalonePairing()) {
      return `Temporary secure standalone remote. Valid until ${formatTimestamp(standalonePairing()!.expiresAt)}.`
    }
    return "Fallback standalone page using the server auth flow."
  })
  const pairingLinks = createMemo(() => {
    const browser = browserPairUrl()
    const server = serverPairUrl()
    const standalone = standalonePairUrl()
    const links: Array<{ id: string; label: string; description: string; url: string }> = []

    if (standalone) {
      links.push({
        id: "standalone",
        label: "Standalone URL",
        description: standalonePairDescription(),
        url: standalone,
      })
    }

    if (browser) {
      links.push({
        id: "app",
        label: "App URL",
        description: "Uses the same host as this web UI.",
        url: browser,
      })
    }

    if (server && server !== browser) {
      links.push({
        id: "server",
        label: "Server URL",
        description: "Uses the configured OpenCode server host.",
        url: server,
      })
    }

    return links
  })
  const shareSupported = createMemo(
    () => typeof navigator !== "undefined" && typeof navigator.share === "function",
  )

  const [sessions, sessionsActions] = createResource(async () => {
    const result = await sdk.client.session.list()
    return [...(result.data ?? [])]
      .filter((session) => !!session?.id)
      .filter((session) => !session.time?.archived)
      .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
  })

  const [messages, messagesActions] = createResource(
    () => currentSessionID(),
    async (sessionID): Promise<MessageEntry[]> => {
      if (!sessionID) return []
      const result = await sdk.client.session.messages({
        sessionID,
        limit: 80,
      })
      return (result.data ?? [])
        .filter((entry) => !!entry?.info?.id)
        .map((entry) => ({
          info: entry.info,
          parts: entry.parts ?? [],
        }))
    },
  )

  const [permissions, permissionsActions] = createResource(async () => {
    const result = await sdk.client.permission.list()
    return [...(result.data ?? [])]
  })

  const [questions, questionsActions] = createResource(async () => {
    const result = await sdk.client.question.list()
    return [...(result.data ?? [])]
  })

  const currentSession = createMemo(() => sessions()?.find((session) => session.id === currentSessionID()))
  const sessionTitle = (sessionID: string) => sessions()?.find((session) => session.id === sessionID)?.title
  const sessionStatus = createMemo(() => {
    const sessionID = currentSessionID()
    if (!sessionID) return undefined
    return sync.data.session_status[sessionID]
  })
  const messageInfos = createMemo(() => (messages() ?? []).map((entry) => entry.info))
  const metrics = createMemo(() => getSessionContextMetrics(messageInfos(), sync.data.provider.all))
  const latestAssistant = createMemo(() => {
    const list = messages() ?? []
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const candidate = list[index]?.info
      if (candidate && isAssistantMessage(candidate)) return candidate
    }
  })
  const modelSummary = createMemo(() => {
    const context = metrics().context
    if (context) return `${context.providerLabel} · ${context.modelLabel}`
    const assistant = latestAssistant()
    if (assistant) return `${assistant.providerID} · ${assistant.modelID}`
    return "—"
  })
  const contextSummary = createMemo(() => {
    const context = metrics().context
    if (!context) return "Context: —"
    const usage = context.usage === null ? "n/a" : `${context.usage}%`
    return `Context: ${formatCompactCount(context.total)} · ${usage}`
  })
  const costSummary = createMemo(() => `Cost: ${formatCurrency(metrics().totalCost)}`)
  const chatSignature = createMemo(() =>
    (messages() ?? [])
      .map((entry) => {
        const completed = entry.info.role === "assistant" && isAssistantMessage(entry.info) ? entry.info.time.completed ?? 0 : 0
        return `${entry.info.id}:${entry.parts.length}:${entry.info.time.created}:${completed}`
      })
      .join("|"),
  )

  const visiblePermissions = createMemo(() => {
    const pending = permissions() ?? []
    const sessionID = currentSessionID()
    if (!sessionID) return pending
    const filtered = pending.filter((request) => request.sessionID === sessionID)
    return filtered.length > 0 ? filtered : pending
  })

  const visibleQuestions = createMemo(() => {
    const pending = questions() ?? []
    const sessionID = currentSessionID()
    if (!sessionID) return pending
    const filtered = pending.filter((request) => request.sessionID === sessionID)
    return filtered.length > 0 ? filtered : pending
  })

  const pendingCount = createMemo(() => (permissions()?.length ?? 0) + (questions()?.length ?? 0))
  const activeLogSessionID = createMemo(() =>
    logScope() === "session" && currentSessionID() ? currentSessionID() : undefined,
  )
  const logSignature = createMemo(() => logs().map((entry) => `${entry.id}:${entry.time}`).join("|"))

  const mergeKnownServices = (entries: LiveLogEntry[]) => {
    setKnownServices((current) =>
      Array.from(new Set([...current, ...entries.map((entry) => entry.service).filter(Boolean)])).sort((a, b) =>
        a.localeCompare(b),
      ),
    )
  }

  const appendLogEntry = (entry: LiveLogEntry) => {
    setLogs((current) => {
      if (current.some((item) => item.id === entry.id)) return current
      const next = [...current, entry]
      return next.slice(Math.max(0, next.length - LOG_LIMIT))
    })
    mergeKnownServices([entry])
  }

  const refreshLogs = async () => {
    const target = buildAbsoluteUrl(sdk.url, "/log")
    if (!target) return

    const auth = buildBasicAuthHeader(server.current?.http)
    const url = new URL(target)
    url.searchParams.set("limit", String(LOG_LIMIT))
    if (serviceFilter()) url.searchParams.set("service", serviceFilter())
    if (levelFilter()) url.searchParams.set("level", levelFilter())
    if (activeLogSessionID()) url.searchParams.set("sessionID", activeLogSessionID()!)

    setLogsLoading(true)
    setLogsError(undefined)
    try {
      const response = await fetch(url.toString(), {
        headers: auth ? { Authorization: auth } : undefined,
      })
      const payload = await response.json().catch(() => [])
      if (!response.ok) {
        throw new Error(
          typeof payload === "object" && payload && "message" in payload
            ? String((payload as { message?: string }).message ?? "Failed to load logs")
            : response.statusText || "Failed to load logs",
        )
      }
      const next = Array.isArray(payload) ? (payload as LiveLogEntry[]).slice(-LOG_LIMIT) : []
      setLogs(next)
      mergeKnownServices(next)
    } catch (cause) {
      setLogsError(formatError(cause))
    } finally {
      setLogsLoading(false)
    }
  }

  const refreshSessions = async () => {
    await sessionsActions.refetch()
  }

  const refreshMessages = async () => {
    if (!currentSessionID()) return
    await messagesActions.refetch()
  }

  const refreshPending = async () => {
    await Promise.all([permissionsActions.refetch(), questionsActions.refetch()])
  }

  const refreshAll = async () => {
    await Promise.all([refreshSessions(), refreshMessages(), refreshPending(), refreshLogs()])
  }

  const openSession = (sessionID: string) => {
    navigate(`${currentRouteBase()}/${sessionID}`)
  }

  const isMessageViewportNearBottom = () => {
    if (!messageViewport) return true
    return messageViewport.scrollHeight - messageViewport.scrollTop - messageViewport.clientHeight < 48
  }

  const isLogViewportNearBottom = () => {
    if (!logViewport) return true
    return logViewport.scrollHeight - logViewport.scrollTop - logViewport.clientHeight < 48
  }

  const jumpToLatest = () => {
    if (!messageViewport) return
    messageViewport.scrollTop = messageViewport.scrollHeight
    setAutoScroll(true)
    setUnseenMessages(0)
  }

  const jumpLogsToLatest = () => {
    if (!logViewport) return
    logViewport.scrollTop = logViewport.scrollHeight
    setLogAutoScroll(true)
    setUnseenLogs(0)
  }

  const onMessageScroll = () => {
    const nearBottom = isMessageViewportNearBottom()
    setAutoScroll(nearBottom)
    if (nearBottom) setUnseenMessages(0)
  }

  const onLogScroll = () => {
    const nearBottom = isLogViewportNearBottom()
    setLogAutoScroll(nearBottom)
    if (nearBottom) setUnseenLogs(0)
  }

  const copyPairingLink = async (label: string, url: string) => {
    setPairingBusy(label)
    setPairingError(undefined)
    setPairingMessage(undefined)
    try {
      const copied = await copyText(url)
      if (!copied) {
        setPairingError(`Could not copy ${label}.`)
        return
      }
      setPairingMessage(`${label} copied.`)
    } finally {
      setPairingBusy(undefined)
    }
  }

  const sharePairingLink = async (label: string, url: string) => {
    setPairingBusy(`${label}:share`)
    setPairingError(undefined)
    setPairingMessage(undefined)
    try {
      const shared = await shareLink({
        title: "OpenCode Mobile Remote",
        text:
          activeShareMode() === "session"
            ? "Open this OpenCode session on your phone."
            : "Open this OpenCode remote workspace on your phone.",
        url,
      })

      if (!shared) {
        setPairingError(`Could not share ${label}.`)
        return
      }

      setPairingMessage(`${label} shared.`)
    } finally {
      setPairingBusy(undefined)
    }
  }

  const openPairingLink = (url: string) => {
    if (typeof window === "undefined") return
    window.open(url, "_blank", "noopener,noreferrer")
  }

  const createSession = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const created = await sdk.client.session.create({
        title: `Mobile remote ${new Date().toLocaleTimeString()}`,
      })
      const session = created.data
      if (!session?.id) throw new Error("Failed to create session")
      await refreshSessions()
      openSession(session.id)
      return session.id
    } catch (cause) {
      setError(formatError(cause))
      return
    } finally {
      setBusy(false)
    }
  }

  const ensureSession = async () => {
    if (currentSessionID()) return currentSessionID()
    return await createSession()
  }

  const submitPrompt = async () => {
    const text = composer().trim()
    if (!text || busy()) return

    setBusy(true)
    setError(undefined)
    try {
      const sessionID = await ensureSession()
      if (!sessionID) return
      setComposer("")
      await sdk.client.session.promptAsync({
        sessionID,
        parts: [{ type: "text", text }],
      })
      await Promise.all([refreshSessions(), refreshMessages(), refreshPending()])
    } catch (cause) {
      setError(formatError(cause))
      setComposer(text)
    } finally {
      setBusy(false)
    }
  }

  const subscriptions = [
    sdk.event.on("session.created", () => void refreshSessions()),
    sdk.event.on("session.updated", () => void refreshSessions()),
    sdk.event.on("session.deleted", () => void refreshSessions()),
    sdk.event.on("message.updated", (event) => {
      if (event.properties.info.sessionID !== currentSessionID()) return
      void refreshMessages()
    }),
    sdk.event.on("message.removed", (event) => {
      if (event.properties.sessionID !== currentSessionID()) return
      void refreshMessages()
    }),
    sdk.event.on("message.part.updated", (event) => {
      if (event.properties.part.sessionID !== currentSessionID()) return
      void refreshMessages()
    }),
    sdk.event.on("message.part.removed", (event) => {
      if (event.properties.sessionID !== currentSessionID()) return
      void refreshMessages()
    }),
    sdk.event.on("session.idle", (event) => {
      if (event.properties.sessionID !== currentSessionID()) return
      void refreshMessages()
    }),
    sdk.event.on("permission.asked", () => void refreshPending()),
    sdk.event.on("permission.replied", (event) => {
      if (event.properties.sessionID === currentSessionID()) void refreshMessages()
      void refreshPending()
    }),
    sdk.event.on("question.asked", () => void refreshPending()),
    sdk.event.on("question.replied", (event) => {
      if (event.properties.sessionID === currentSessionID()) void refreshMessages()
      void refreshPending()
    }),
    sdk.event.on("question.rejected", (event) => {
      if (event.properties.sessionID === currentSessionID()) void refreshMessages()
      void refreshPending()
    }),
  ]

  createEffect(() => {
    const socketUrl = buildSocketUrl(sdk.url, "/log/connect", server.current?.http, {
      service: serviceFilter() || undefined,
      level: levelFilter() || undefined,
      sessionID: activeLogSessionID(),
    })
    if (!socketUrl || typeof WebSocket === "undefined") {
      setLogsConnection("offline")
      return
    }

    void refreshLogs()

    let disposed = false
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let reconnectAttempts = 0
    let socket: WebSocket | undefined

    const clearReconnect = () => {
      if (reconnectTimer === undefined) return
      clearTimeout(reconnectTimer)
      reconnectTimer = undefined
    }

    const open = () => {
      if (disposed) return
      setLogsConnection(reconnectAttempts > 0 ? "reconnecting" : "connecting")
      socket = new WebSocket(socketUrl)

      socket.addEventListener("open", () => {
        if (disposed) return
        reconnectAttempts = 0
        setLogsConnection("live")
        setLogsError(undefined)
      })

      socket.addEventListener("message", (event) => {
        if (disposed) return
        try {
          const payload = JSON.parse(typeof event.data === "string" ? event.data : "") as LiveLogEntry
          if (!payload?.id) return
          appendLogEntry(payload)
        } catch (cause) {
          setLogsError(formatError(cause))
        }
      })

      socket.addEventListener("error", () => {
        if (disposed) return
        setLogsConnection("offline")
      })

      socket.addEventListener("close", (event) => {
        if (disposed) return
        socket = undefined
        if (event.code === 1000) {
          setLogsConnection("offline")
          return
        }
        reconnectAttempts += 1
        setLogsConnection("reconnecting")
        clearReconnect()
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined
          void refreshLogs()
          open()
        }, Math.min(1000 * reconnectAttempts, 4000))
      })
    }

    open()

    onCleanup(() => {
      disposed = true
      clearReconnect()
      if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
        socket.close(1000)
      }
    })
  })

  onCleanup(() => {
    for (const unsubscribe of subscriptions) unsubscribe()
  })

  createEffect(
    on(
      chatSignature,
      (_, previous) => {
        if (!messageViewport || !currentSessionID()) return
        const shouldStick = previous === undefined || autoScroll() || isMessageViewportNearBottom()
        requestAnimationFrame(() => {
          if (!messageViewport) return
          if (shouldStick) {
            jumpToLatest()
            return
          }
          setUnseenMessages((count) => count + 1)
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      currentSessionID,
      (sessionID) => {
        if (!sessionID && logScope() === "session") {
          setLogScope("workspace")
        }
        setAutoScroll(true)
        setUnseenMessages(0)
        requestAnimationFrame(() => jumpToLatest())
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      logSignature,
      (_, previous) => {
        if (!logViewport) return
        const shouldStick = previous === undefined || logAutoScroll() || isLogViewportNearBottom()
        requestAnimationFrame(() => {
          if (!logViewport) return
          if (shouldStick) {
            jumpLogsToLatest()
            return
          }
          setUnseenLogs((count) => count + 1)
        })
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      () => [serviceFilter(), levelFilter(), activeLogSessionID()] as const,
      () => {
        setLogAutoScroll(true)
        setUnseenLogs(0)
        requestAnimationFrame(() => jumpLogsToLatest())
      },
      { defer: true },
    ),
  )

  return (
    <div class="size-full flex flex-col bg-background-base text-text-base">
      <div class="border-b border-border-default px-4 py-3 flex flex-col gap-2">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-16-medium text-text-strong">Mobile Remote MVP</div>
            <div class="text-12-regular text-text-weak break-all">{sdk.url}</div>
          </div>
          <button
            type="button"
            class="rounded-md border border-border-default px-3 py-2 text-12-medium"
            onClick={() => void refreshAll()}
          >
            Refresh
          </button>
        </div>
        <div class="text-12-regular text-text-weak break-all">{sdk.directory}</div>
      </div>

      <Show when={error()}>
        {(message) => (
          <div class="mx-4 mt-3 rounded-lg border border-status-error-base bg-status-error-subtle px-3 py-2 text-12-regular text-status-error-base">
            {message()}
          </div>
        )}
      </Show>

      <section class="mx-4 mt-3 min-h-0 rounded-xl border border-border-default bg-surface-base flex flex-col overflow-hidden">
        <div class="border-b border-border-default px-4 py-3 flex flex-col gap-3">
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="text-14-medium text-text-strong">Pair / share</div>
              <div class="mt-1 text-12-regular text-text-weak">
                {activeShareMode() === "session"
                  ? "This link opens the selected session directly on your phone."
                  : "This link opens the mobile remote workspace home on your phone."}
              </div>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <Show when={currentSessionID()}>
                <button
                  type="button"
                  class="rounded-full border px-3 py-1.5 text-11-medium transition-colors"
                  classList={{
                    "border-accent-base bg-accent-subtle text-accent-base": activeShareMode() === "workspace",
                    "border-border-default bg-background-base text-text-base": activeShareMode() !== "workspace",
                  }}
                  onClick={() => setShareMode("workspace")}
                >
                  Workspace
                </button>
                <button
                  type="button"
                  class="rounded-full border px-3 py-1.5 text-11-medium transition-colors"
                  classList={{
                    "border-accent-base bg-accent-subtle text-accent-base": activeShareMode() === "session",
                    "border-border-default bg-background-base text-text-base": activeShareMode() !== "session",
                  }}
                  onClick={() => setShareMode("session")}
                >
                  Session
                </button>
              </Show>
              <button
                type="button"
                class="rounded-md border border-border-default px-3 py-2 text-12-medium disabled:opacity-50"
                disabled={standalonePairing.loading}
                onClick={() => void standalonePairingActions.refetch()}
              >
                {standalonePairing.loading ? "Generating…" : "Regenerate secure link"}
              </button>
            </div>
          </div>

          <Show when={pairingMessage()}>
            {(message) => (
              <div class="rounded-lg border border-accent-base bg-accent-subtle px-3 py-2 text-12-regular text-accent-base">
                {message()}
              </div>
            )}
          </Show>

          <Show when={pairingError()}>
            {(message) => (
              <div class="rounded-lg border border-status-error-base bg-status-error-subtle px-3 py-2 text-12-regular text-status-error-base">
                {message()}
              </div>
            )}
          </Show>

          <Show when={standalonePairing.error}>
            {(cause) => (
              <div class="rounded-lg border border-status-warning-base bg-status-warning-subtle px-3 py-2 text-12-regular text-status-warning-base">
                Could not create a temporary secure standalone link: {formatError(cause())}
              </div>
            )}
          </Show>
        </div>

        <div class="p-4 flex flex-col gap-3">
          <Switch>
            <Match when={pairingLinks().length === 0}>
              <div class="rounded-lg border border-dashed border-border-default px-4 py-6 text-12-regular text-text-weak">
                No HTTP pairing link is available from this environment yet.
              </div>
            </Match>
            <Match when={true}>
              <>
                <For each={pairingLinks()}>
                  {(link) => (
                    <article class="rounded-xl border border-border-default bg-background-base px-4 py-3 flex flex-col gap-3">
                      <div>
                        <div class="text-13-medium text-text-strong">{link.label}</div>
                        <div class="mt-1 text-12-regular text-text-weak">{link.description}</div>
                      </div>

                      <input
                        readOnly
                        value={link.url}
                        class="w-full rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-12-regular text-text-base outline-none"
                      />

                      <PairingQr url={link.url} label={link.label} />

                      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                          type="button"
                          class="rounded-lg bg-accent-base px-3 py-2 text-12-medium text-white disabled:opacity-50"
                          disabled={!!pairingBusy()}
                          onClick={() => void copyPairingLink(link.label, link.url)}
                        >
                          {pairingBusy() === link.label ? "Copying…" : "Copy link"}
                        </button>
                        <Show when={shareSupported()}>
                          <button
                            type="button"
                            class="rounded-lg border border-border-default bg-surface-raised px-3 py-2 text-12-medium disabled:opacity-50"
                            disabled={!!pairingBusy()}
                            onClick={() => void sharePairingLink(link.label, link.url)}
                          >
                            {pairingBusy() === `${link.label}:share` ? "Sharing…" : "Share"}
                          </button>
                        </Show>
                        <button
                          type="button"
                          class="rounded-lg border border-border-default bg-background-base px-3 py-2 text-12-medium disabled:opacity-50"
                          disabled={!!pairingBusy()}
                          onClick={() => openPairingLink(link.url)}
                        >
                          Open
                        </button>
                      </div>
                    </article>
                  )}
                </For>

                <div class="rounded-lg border border-dashed border-border-default px-4 py-3 text-12-regular text-text-weak">
                  Open one of these links on your phone. If one host is not reachable from the phone, try the other.
                </div>
              </>
            </Match>
          </Switch>
        </div>
      </section>

      <section class="mx-4 mt-3 min-h-0 rounded-xl border border-border-default bg-surface-base flex flex-col overflow-hidden">
        <div class="border-b border-border-default px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <div class="text-14-medium text-text-strong">Pending approvals & questions</div>
            <div class="mt-1 text-12-regular text-text-weak">
              {currentSessionID()
                ? "Current session items are prioritized."
                : "All pending items for this workspace appear here."}
            </div>
          </div>
          <div class="rounded-full bg-surface-raised px-3 py-1 text-12-medium">{pendingCount()}</div>
        </div>

        <div class="max-h-[32rem] overflow-y-auto p-4 flex flex-col gap-3">
          <Switch>
            <Match when={permissions.loading || questions.loading}>
              <div class="text-12-regular text-text-weak">Loading pending items…</div>
            </Match>
            <Match when={pendingCount() === 0}>
              <div class="rounded-lg border border-dashed border-border-default px-4 py-6 text-12-regular text-text-weak">
                No pending approvals or questions.
              </div>
            </Match>
            <Match when={true}>
              <>
                <For each={visiblePermissions()}>
                  {(request) => (
                    <PermissionCard
                      request={request}
                      sessionTitle={sessionTitle(request.sessionID)}
                      onHandled={refreshAll}
                    />
                  )}
                </For>
                <For each={visibleQuestions()}>
                  {(request) => (
                    <QuestionCard request={request} sessionTitle={sessionTitle(request.sessionID)} onHandled={refreshAll} />
                  )}
                </For>
              </>
            </Match>
          </Switch>
        </div>
      </section>

      <section class="mx-4 mt-3 min-h-0 rounded-xl border border-border-default bg-surface-base flex flex-col overflow-hidden">
        <div class="border-b border-border-default px-4 py-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="text-14-medium text-text-strong">Live process logs</div>
            <div class="mt-1 text-12-regular text-text-weak">
              Workspace-wide structured server logs streamed live from this OpenCode instance.
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class={`rounded-full px-2.5 py-1 text-11-medium ${logConnectionTone(logsConnection())}`}>
              {logConnectionLabel(logsConnection())}
            </span>
            <span class="rounded-full bg-surface-raised px-2.5 py-1 text-11-regular text-text-weak">
              {logs().length} entries
            </span>
            <Show when={unseenLogs() > 0}>
              <button
                type="button"
                class="rounded-full border border-accent-base bg-accent-subtle px-3 py-1.5 text-11-medium text-accent-base"
                onClick={jumpLogsToLatest}
              >
                Jump to latest ({unseenLogs()})
              </button>
            </Show>
            <button
              type="button"
              class="rounded-md border border-border-default px-3 py-1.5 text-12-medium"
              onClick={() => void refreshLogs()}
            >
              Refresh logs
            </button>
          </div>
        </div>

        <Show when={logsError()}>
          {(message) => (
            <div class="mx-4 mt-3 rounded-lg border border-status-error-base bg-status-error-subtle px-3 py-2 text-12-regular text-status-error-base">
              {message()}
            </div>
          )}
        </Show>

        <div class="px-4 pt-3 flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-11-medium uppercase tracking-wide text-text-weak">Scope</span>
            <button
              type="button"
              class="rounded-full border px-3 py-1.5 text-11-medium transition-colors"
              classList={{
                "border-accent-base bg-accent-subtle text-accent-base": logScope() === "workspace",
                "border-border-default bg-background-base text-text-base": logScope() !== "workspace",
              }}
              onClick={() => setLogScope("workspace")}
            >
              Workspace
            </button>
            <button
              type="button"
              class="rounded-full border px-3 py-1.5 text-11-medium transition-colors disabled:opacity-50"
              classList={{
                "border-accent-base bg-accent-subtle text-accent-base": logScope() === "session",
                "border-border-default bg-background-base text-text-base": logScope() !== "session",
              }}
              disabled={!currentSessionID()}
              onClick={() => setLogScope("session")}
            >
              Active session
            </button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-[minmax(0,16rem)_1fr] gap-3">
            <label class="flex flex-col gap-1">
              <span class="text-11-medium uppercase tracking-wide text-text-weak">Service</span>
              <select
                class="rounded-lg border border-border-default bg-background-base px-3 py-2 text-12-regular text-text-base outline-none"
                value={serviceFilter()}
                onChange={(event) => setServiceFilter(event.currentTarget.value)}
              >
                <option value="">All services</option>
                <For each={knownServices()}>
                  {(service) => <option value={service}>{service}</option>}
                </For>
              </select>
            </label>

            <div class="flex flex-col gap-1">
              <span class="text-11-medium uppercase tracking-wide text-text-weak">Level</span>
              <div class="flex flex-wrap gap-2">
                <For each={["", "INFO", "WARN", "ERROR", "DEBUG"] as const}>
                  {(level) => (
                    <button
                      type="button"
                      class="rounded-full border px-3 py-1.5 text-11-medium transition-colors"
                      classList={{
                        "border-accent-base bg-accent-subtle text-accent-base": levelFilter() === level,
                        "border-border-default bg-background-base text-text-base": levelFilter() !== level,
                      }}
                      onClick={() => setLevelFilter(level)}
                    >
                      {level || "All levels"}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>

        <div ref={logViewport} onScroll={onLogScroll} class="max-h-[28rem] overflow-y-auto p-4 flex flex-col gap-3">
          <Switch>
            <Match when={logsLoading() && logs().length === 0}>
              <div class="text-12-regular text-text-weak">Loading logs…</div>
            </Match>
            <Match when={logs().length === 0}>
              <div class="rounded-lg border border-dashed border-border-default px-4 py-6 text-12-regular text-text-weak">
                Waiting for live server logs.
              </div>
            </Match>
            <Match when={true}>
              <For each={logs()}>
                {(entry) => <LogCard entry={entry} />}
              </For>
            </Match>
          </Switch>
        </div>
      </section>

      <div class="flex-1 overflow-hidden p-4 grid grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)] gap-4">
        <section class="min-h-0 rounded-xl border border-border-default bg-surface-base flex flex-col overflow-hidden">
          <div class="border-b border-border-default px-4 py-3 flex items-center justify-between">
            <div class="text-14-medium text-text-strong">Sessions</div>
            <button
              type="button"
              class="rounded-md bg-surface-raised px-3 py-1.5 text-12-medium"
              disabled={busy()}
              onClick={() => void createSession()}
            >
              New
            </button>
          </div>

          <div class="flex-1 overflow-y-auto p-2">
            <Switch>
              <Match when={sessions.loading}>
                <div class="px-2 py-3 text-12-regular text-text-weak">Loading sessions…</div>
              </Match>
              <Match when={(sessions()?.length ?? 0) === 0}>
                <div class="px-2 py-3 text-12-regular text-text-weak">
                  No sessions yet. Send a prompt to create the first mobile session.
                </div>
              </Match>
              <Match when={true}>
                <div class="flex flex-col gap-2">
                  <For each={sessions()}>
                    {(session) => {
                      const active = createMemo(() => session.id === currentSessionID())
                      return (
                        <button
                          type="button"
                          class="w-full text-left rounded-lg border px-3 py-3 transition-colors"
                          classList={{
                            "border-accent-base bg-accent-subtle": active(),
                            "border-border-default bg-background-base": !active(),
                          }}
                          onClick={() => openSession(session.id)}
                        >
                          <div class="text-13-medium text-text-strong truncate">{session.title || "Untitled session"}</div>
                          <div class="mt-1 text-11-regular text-text-weak">{formatTimestamp(session.time.updated)}</div>
                        </button>
                      )
                    }}
                  </For>
                </div>
              </Match>
            </Switch>
          </div>
        </section>

        <section class="min-h-0 rounded-xl border border-border-default bg-surface-base flex flex-col overflow-hidden">
          <div class="border-b border-border-default px-4 py-3">
            <div class="text-14-medium text-text-strong">{currentSession()?.title ?? "New mobile session"}</div>
            <div class="mt-1 text-12-regular text-text-weak">
              {currentSessionID() ? `Session ID: ${currentSessionID()}` : "No session selected"}
            </div>
          </div>

          <div class="border-b border-border-default px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class={`rounded-full px-2.5 py-1 text-11-medium ${sessionStatusTone(sessionStatus())}`}>
                {sessionStatusLabel(sessionStatus())}
              </span>
              <span class="rounded-full bg-surface-raised px-2.5 py-1 text-11-regular text-text-weak">
                {contextSummary()}
              </span>
              <span class="rounded-full bg-surface-raised px-2.5 py-1 text-11-regular text-text-weak">
                {costSummary()}
              </span>
            </div>
            <Show when={unseenMessages() > 0}>
              <button
                type="button"
                class="rounded-full border border-accent-base bg-accent-subtle px-3 py-1.5 text-11-medium text-accent-base"
                onClick={jumpToLatest}
              >
                Jump to latest ({unseenMessages()})
              </button>
            </Show>
          </div>

          <div class="border-b border-border-default px-4 py-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div class="rounded-lg border border-border-default bg-background-base px-3 py-3">
              <div class="text-11-medium uppercase tracking-wide text-text-weak">Model</div>
              <div class="mt-1 text-12-medium text-text-strong break-words">{modelSummary()}</div>
              <div class="mt-1 text-11-regular text-text-weak">
                {latestAssistant() ? "Latest assistant response" : "Waiting for model output"}
              </div>
            </div>
            <div class="rounded-lg border border-border-default bg-background-base px-3 py-3">
              <div class="text-11-medium uppercase tracking-wide text-text-weak">Messages</div>
              <div class="mt-1 text-12-medium text-text-strong">{messages()?.length ?? 0}</div>
              <div class="mt-1 text-11-regular text-text-weak">
                {hasRenderableText((messages() ?? []).flatMap((entry) => entry.parts))
                  ? "Rich message parts available"
                  : "No text output yet"}
              </div>
            </div>
            <div class="rounded-lg border border-border-default bg-background-base px-3 py-3">
              <div class="text-11-medium uppercase tracking-wide text-text-weak">Pending</div>
              <div class="mt-1 text-12-medium text-text-strong">{pendingCount()}</div>
              <div class="mt-1 text-11-regular text-text-weak">Approvals and questions across this workspace</div>
            </div>
          </div>

          <div ref={messageViewport} onScroll={onMessageScroll} class="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            <Switch>
              <Match when={!currentSessionID()}>
                <div class="rounded-lg border border-dashed border-border-default px-4 py-6 text-12-regular text-text-weak">
                  Pick a session from the list or send a prompt below to create a new mobile session.
                </div>
              </Match>
              <Match when={messages.loading}>
                <div class="text-12-regular text-text-weak">Loading messages…</div>
              </Match>
              <Match when={(messages()?.length ?? 0) === 0}>
                <div class="rounded-lg border border-dashed border-border-default px-4 py-6 text-12-regular text-text-weak">
                  No messages yet for this session.
                </div>
              </Match>
              <Match when={true}>
                <For each={messages()}>
                  {(entry) => <MessageCard entry={entry} />}
                </For>
              </Match>
            </Switch>
          </div>

          <div class="border-t border-border-default p-4 flex flex-col gap-3">
            <textarea
              class="min-h-28 w-full resize-y rounded-lg border border-border-default bg-background-base px-3 py-3 text-14-regular text-text-base outline-none"
              placeholder="Send a prompt to the current session"
              value={composer()}
              onInput={(event) => setComposer(event.currentTarget.value)}
            />
            <div class="flex items-center justify-between gap-3">
              <div class="text-11-regular text-text-weak">
                {busy()
                  ? "Working…"
                  : currentSessionID()
                    ? "Prompt will be sent to the selected session."
                    : "A new session will be created automatically."}
              </div>
              <button
                type="button"
                class="rounded-lg bg-accent-base px-4 py-2 text-13-medium text-white disabled:opacity-50"
                disabled={busy() || composer().trim().length === 0}
                onClick={() => void submitPrompt()}
              >
                Send
              </button>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
