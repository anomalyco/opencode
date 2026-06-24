/**
 * Monitor / Channels tab.
 *
 * CRUD for webhook destinations. The form dynamically renders credential
 * inputs based on the provider registry so adding a new provider does
 * not require touching this file.
 *
 * "Send test" issues a real HTTP request via the monitor `delivery`
 * helper (timeout 10s, single attempt). The result is shown inline.
 */

import { createResource, createSignal, For, Show, createMemo, batch } from "solid-js"
import { useLanguage } from "@/context/language"
import { createMonitorClient } from "@/utils/monitor-sdk"
import type { ChannelPublic, ChannelWrite } from "@/utils/monitor-schema"

const PROVIDER_TYPES: ChannelWrite["type"][] = [
  "slack",
  "discord",
  "teams",
  "google-chat",
  "mattermost",
  "rocketchat",
  "telegram",
  "pagerduty",
  "opsgenie",
  "splunk-oncall",
  "zapier",
  "make",
  "n8n",
  "pipedream",
  "generic",
]

function ChannelRow(props: {
  channel: ChannelPublic
  onTest: (id: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  language: ReturnType<typeof useLanguage>
}) {
  const [testing, setTesting] = createSignal(false)
  const [testResult, setTestResult] = createSignal<string | null>(null)
  return (
    <article class="rounded border border-border-weak-base bg-surface-base p-3 flex flex-col gap-2 text-12-regular">
      <header class="flex items-center justify-between">
        <div class="flex flex-col">
          <span class="text-text-strong">{props.channel.name}</span>
          <span class="text-11-regular text-text-weak font-mono">{props.channel.type}</span>
        </div>
        <span
          classList={{
            "size-2 rounded-full": true,
            "bg-status-working-base": props.channel.enabled,
            "bg-border-weak-base": !props.channel.enabled,
          }}
        />
      </header>
      <Show when={testResult()}>
        <p class="text-11-regular text-text-weak">{testResult()}</p>
      </Show>
      <footer class="flex items-center gap-2">
        <button
          type="button"
          disabled={testing()}
          onClick={async () => {
            setTesting(true)
            setTestResult(null)
            try {
              await props.onTest(props.channel.id)
              setTestResult("sent")
            } catch (err) {
              setTestResult(err instanceof Error ? err.message : String(err))
            } finally {
              setTesting(false)
            }
          }}
          class="px-2 py-1 text-11-medium rounded bg-surface-base text-text-base border border-border-weak-base disabled:opacity-50"
        >
          {testing() ? "…" : props.language.t("monitor.channels.test")}
        </button>
        <button
          type="button"
          onClick={async () => {
            if (!confirm(`Delete ${props.channel.name}?`)) return
            await props.onDelete(props.channel.id)
          }}
          class="px-2 py-1 text-11-medium rounded bg-surface-base text-status-error-base border border-border-weak-base"
        >
          {props.language.t("monitor.common.delete")}
        </button>
      </footer>
    </article>
  )
}

function CreateChannelForm(props: {
  onSubmit: (input: Omit<ChannelWrite, "project_id">) => Promise<void>
  language: ReturnType<typeof useLanguage>
}) {
  const [type, setType] = createSignal<ChannelWrite["type"]>("slack")
  const [name, setName] = createSignal("")
  const [url, setUrl] = createSignal("")
  const [secret, setSecret] = createSignal("")
  const [creds, setCreds] = createSignal<Record<string, string>>({})
  const [submitting, setSubmitting] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

  // Re-render credential fields when type changes. We hardcode the
  // credential metadata here so we don't need a separate registry roundtrip;
  // the server returns the canonical `credentialFields` only after the
  // channel exists.
  const fields = createMemo(() => {
    switch (type()) {
      case "slack":
      case "discord":
      case "teams":
      case "google-chat":
      case "mattermost":
      case "rocketchat":
      case "zapier":
      case "make":
      case "n8n":
      case "pipedream":
        return [{ key: "webhook_url", label: "Webhook URL", required: true, secret: true }]
      case "telegram":
        return [
          { key: "bot_token", label: "Bot token", required: true, secret: true },
          { key: "chat_id", label: "Chat ID", required: true, secret: false },
        ]
      case "pagerduty":
        return [{ key: "routing_key", label: "Routing key", required: true, secret: true }]
      case "opsgenie":
        return [
          { key: "api_key", label: "API key (GenieKey)", required: true, secret: true },
          { key: "region", label: "Region (us/eu)", required: true, secret: false },
        ]
      case "splunk-oncall":
        return [{ key: "api_key", label: "API key", required: true, secret: true }]
      case "generic":
        return [
          { key: "url", label: "URL", required: true, secret: false },
          { key: "hmac_secret", label: "HMAC secret (optional)", required: false, secret: true },
        ]
    }
  })

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      await props.onSubmit({
        type: type(),
        name: name(),
        url: url() || undefined,
        credentials: creds(),
        secret: secret() || undefined,
        enabled: true,
      })
      batch(() => {
        setName("")
        setUrl("")
        setSecret("")
        setCreds({})
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      class="rounded-lg border border-border-weak-base bg-surface-base p-4 flex flex-col gap-3 text-12-regular"
    >
      <h3 class="text-13-medium text-text-base">{props.language.t("monitor.channels.create")}</h3>

      <div class="grid gap-2" style={{ "grid-template-columns": "1fr 1fr" }}>
        <label class="flex flex-col gap-1">
          <span class="text-11-regular text-text-weak">Type</span>
          <select
            value={type()}
            onChange={(e) => {
              setType(e.currentTarget.value as ChannelWrite["type"])
              setCreds({})
            }}
            class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
          >
            <For each={PROVIDER_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-11-regular text-text-weak">Name</span>
          <input
            value={name()}
            onInput={(e) => setName(e.currentTarget.value)}
            required
            class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
          />
        </label>
      </div>

      <Show when={type() === "generic"}>
        <label class="flex flex-col gap-1">
          <span class="text-11-regular text-text-weak">URL (overrides credentials.url)</span>
          <input
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
            placeholder="https://example.com/hook"
            class="px-2 py-1 rounded border border-border-weak-base bg-surface-base"
          />
        </label>
      </Show>

      <For each={fields()}>
        {(field) => (
          <label class="flex flex-col gap-1">
            <span class="text-11-regular text-text-weak">
              {field.label} {field.required && <span class="text-status-error-base">*</span>}
            </span>
            <input
              type={field.secret ? "password" : "text"}
              value={creds()[field.key] ?? ""}
              onInput={(e) =>
                setCreds((prev) => ({ ...prev, [field.key]: e.currentTarget.value }))
              }
              class="px-2 py-1 rounded border border-border-weak-base bg-surface-base font-mono"
            />
          </label>
        )}
      </For>

      <label class="flex flex-col gap-1">
        <span class="text-11-regular text-text-weak">HMAC secret (optional, generic provider)</span>
        <input
          type="password"
          value={secret()}
          onInput={(e) => setSecret(e.currentTarget.value)}
          class="px-2 py-1 rounded border border-border-weak-base bg-surface-base font-mono"
        />
      </label>

      <Show when={error()}>
        <p class="text-11-regular text-status-error-base">{error()}</p>
      </Show>

      <button
        type="submit"
        disabled={submitting() || !name()}
        class="px-3 py-1.5 text-12-medium rounded bg-surface-strong-base text-text-base disabled:opacity-50 self-start"
      >
        {submitting() ? "…" : props.language.t("monitor.common.save")}
      </button>
    </form>
  )
}

export function MonitorChannels(props: { baseUrl: string }) {
  const language = useLanguage()
  const client = createMonitorClient({ baseUrl: props.baseUrl })
  const [channels, { refetch }] = createResource(() => client.channels())

  async function onCreate(input: Omit<ChannelWrite, "project_id">) {
    // Server fills project_id from the workspace context.
    await client.createChannel({ ...input, project_id: "default" } as ChannelWrite)
    refetch()
  }

  async function onTest(id: string) {
    const r = await client.channelTest(id)
    if (!r.ok) throw new Error(r.error ?? `HTTP ${r.status ?? "?"}`)
  }

  async function onDelete(id: string) {
    await client.deleteChannel(id)
    refetch()
  }

  return (
    <div class="flex flex-col gap-4">
      <header>
        <h2 class="text-14-medium text-text-base">{language.t("monitor.channels.title")}</h2>
      </header>

      <CreateChannelForm onSubmit={onCreate} language={language} />

      <Show
        when={channels() && channels()!.length}
        fallback={<p class="text-12-regular text-text-weak">{language.t("monitor.common.empty")}</p>}
      >
        <div class="grid gap-2" style={{ "grid-template-columns": "repeat(auto-fill, minmax(280px, 1fr))" }}>
          <For each={channels()}>
            {(c) => <ChannelRow channel={c} onTest={onTest} onDelete={onDelete} language={language} />}
          </For>
        </div>
      </Show>
    </div>
  )
}