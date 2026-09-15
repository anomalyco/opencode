import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Tag } from "@opencode-ai/ui/v2/badge-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { type Accessor, type Component, For, Show, createMemo, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import type { McpTestResult } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import type { McpServerConfig } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import "./settings-v2.css"

type ServerType = "local" | "remote"

interface FormState {
  name: string
  type: ServerType
  command: string
  url: string
  environment: string
  headers: string
  enabled: boolean
  error?: string
}

function parseKeyValues(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key) continue
    out[key] = trimmed.slice(eq + 1).trim()
  }
  return Object.keys(out).length ? out : undefined
}

function formatKeyValues(record?: Record<string, string>): string {
  if (!record) return ""
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

export const DialogMcpV2: Component<{
  mode: "add" | "edit"
  name?: string
  config?: McpServerConfig
  directory: Accessor<string | undefined>
}> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const serverSync = useServerSync()
  const [saving, setSaving] = createSignal(false)

  const [form, setForm] = createStore<FormState>({
    name: props.name ?? "",
    type: props.config?.type ?? "local",
    command: props.config?.type === "local" ? props.config.command.join(" ") : "",
    url: props.config?.type === "remote" ? props.config.url : "",
    environment: formatKeyValues(props.config?.type === "local" ? props.config.environment : undefined),
    headers: formatKeyValues(props.config?.type === "remote" ? props.config.headers : undefined),
    enabled: props.config?.enabled !== false,
  })

  const [testing, setTesting] = createSignal(false)
  const [testResult, setTestResult] = createSignal<McpTestResult | undefined>()

  const title = () =>
    props.mode === "add" ? language.t("dialog.mcp.form.title.add") : language.t("dialog.mcp.form.title.edit")

  const validate = (): McpServerConfig | undefined => {
    if (!form.name.trim()) {
      setForm("error", language.t("dialog.mcp.form.error.name"))
      return
    }
    if (form.type === "local") {
      const command = form.command.trim().split(/\s+/).filter(Boolean)
      if (command.length === 0) {
        setForm("error", language.t("dialog.mcp.form.error.command"))
        return
      }
      setForm("error", undefined)
      return {
        type: "local",
        command,
        environment: parseKeyValues(form.environment),
        enabled: form.enabled,
      }
    }
    const url = form.url.trim()
    if (!url || !URL.canParse(url)) {
      setForm("error", language.t("dialog.mcp.form.error.url"))
      return
    }
    setForm("error", undefined)
    return {
      type: "remote",
      url,
      headers: parseKeyValues(form.headers),
      enabled: form.enabled,
    }
  }

  const runTest = async () => {
    const config = validate()
    if (!config) return
    const dir = props.directory()
    if (!dir) {
      showToast({
        variant: "error",
        title: language.t("dialog.mcp.form.test"),
        description: language.t("settings.mcp.noWorkspace"),
      })
      return
    }
    setTesting(true)
    setTestResult(undefined)
    try {
      const result = await serverSync().mcp.test(dir, form.name.trim() || "test", config)
      setTestResult(result)
    } catch (error) {
      setTestResult({
        status: { status: "failed", error: error instanceof Error ? error.message : String(error) },
        reachable: false,
        authStatus: "not_authenticated",
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setTesting(false)
    }
  }

  const submit = async () => {
    const config = validate()
    if (!config) return
    const dir = props.directory()
    if (!dir) {
      showToast({
        variant: "error",
        title: language.t("settings.mcp.toast.saveFailed"),
        description: language.t("settings.mcp.noWorkspace"),
      })
      return
    }
    setSaving(true)
    try {
      await serverSync().mcp.save(dir, form.name.trim(), config)
      dialog.close()
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("settings.mcp.toast.saveFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }

  const busy = createMemo(() => testing() || saving())

  return (
    <Dialog fit class="settings-v2-server-dialog">
      <DialogHeader hideClose={true}>
        <DialogTitle>{title()}</DialogTitle>
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="flex w-full min-w-0 flex-1 flex-col px-4 pt-4 pb-2">
        <div class="flex w-full min-w-0 flex-col gap-6">
          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("dialog.mcp.form.name")}</label>
            <TextInputV2
              type="text"
              appearance="large"
              class="!w-full self-stretch"
              value={form.name}
              placeholder={language.t("dialog.mcp.form.name.placeholder")}
              disabled={props.mode === "edit" || busy()}
              autofocus={props.mode === "add"}
              onInput={(event) => setForm("name", event.currentTarget.value)}
            />
          </div>

          <div class="flex w-full min-w-0 flex-col gap-2">
            <label class="settings-v2-server-dialog-label">{language.t("dialog.mcp.form.type")}</label>
            <div class="flex gap-2">
              <ButtonV2
                variant={form.type === "local" ? "contrast" : "neutral"}
                disabled={busy()}
                onClick={() => setForm("type", "local")}
              >
                {language.t("settings.mcp.type.local")}
              </ButtonV2>
              <ButtonV2
                variant={form.type === "remote" ? "contrast" : "neutral"}
                disabled={busy()}
                onClick={() => setForm("type", "remote")}
              >
                {language.t("settings.mcp.type.remote")}
              </ButtonV2>
            </div>
          </div>

          <Show when={form.type === "local"}>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.mcp.form.command")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={form.command}
                placeholder={language.t("dialog.mcp.form.command.placeholder")}
                disabled={busy()}
                onInput={(event) => setForm("command", event.currentTarget.value)}
              />
              <span class="settings-v2-server-dialog-hint">{language.t("dialog.mcp.form.command.hint")}</span>
            </div>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.mcp.form.environment")}</label>
              <TextareaV2
                class="!w-full self-stretch"
                value={form.environment}
                rows={3}
                disabled={busy()}
                onInput={(event) => setForm("environment", event.currentTarget.value)}
              />
              <span class="settings-v2-server-dialog-hint">{language.t("dialog.mcp.form.keyValue.hint")}</span>
            </div>
          </Show>

          <Show when={form.type === "remote"}>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.mcp.form.url")}</label>
              <TextInputV2
                type="text"
                appearance="large"
                class="!w-full self-stretch"
                value={form.url}
                placeholder={language.t("dialog.mcp.form.url.placeholder")}
                disabled={busy()}
                onInput={(event) => setForm("url", event.currentTarget.value)}
              />
            </div>
            <div class="flex w-full min-w-0 flex-col gap-2">
              <label class="settings-v2-server-dialog-label">{language.t("dialog.mcp.form.headers")}</label>
              <TextareaV2
                class="!w-full self-stretch"
                value={form.headers}
                rows={3}
                disabled={busy()}
                onInput={(event) => setForm("headers", event.currentTarget.value)}
              />
              <span class="settings-v2-server-dialog-hint">{language.t("dialog.mcp.form.keyValue.hint")}</span>
            </div>
          </Show>

          <Switch checked={form.enabled} disabled={busy()} onChange={(value) => setForm("enabled", value)}>
            {language.t("dialog.mcp.form.enabled")}
          </Switch>

          <Show when={form.error}>
            <span class="settings-v2-server-dialog-error">{form.error}</span>
          </Show>

          <Show when={testResult()}>
            {(result) => (
              <div class="settings-v2-mcp-test-result flex flex-col gap-2">
                <div class="flex items-center gap-2">
                  <Tag variant={result().reachable ? "accent" : "neutral"}>
                    {result().reachable
                      ? language.t("dialog.mcp.test.reachable")
                      : language.t("dialog.mcp.test.unreachable")}
                  </Tag>
                  <Show when={result().status.status === "connected"}>
                    <Tag variant="accent">{language.t("dialog.mcp.test.success")}</Tag>
                  </Show>
                  <Show when={form.type === "remote"}>
                    <span class="text-11-regular text-v2-icon-icon-muted">
                      {language.t("dialog.mcp.test.auth")}: {result().authStatus}
                    </span>
                  </Show>
                </div>
                <div class="flex flex-col gap-1">
                  <span class="settings-v2-server-dialog-label">
                    {language.t("dialog.mcp.test.tools")} ({result().tools.length})
                  </span>
                  <Show
                    when={result().tools.length > 0}
                    fallback={
                      <span class="text-11-regular text-v2-icon-icon-muted">
                        {language.t("dialog.mcp.test.tools.none")}
                      </span>
                    }
                  >
                    <div class="flex flex-wrap gap-1">
                      <For each={result().tools}>{(tool) => <Tag>{tool}</Tag>}</For>
                    </div>
                  </Show>
                </div>
                <Show when={result().error}>
                  <div class="flex flex-col gap-1">
                    <span class="settings-v2-server-dialog-label">{language.t("dialog.mcp.test.error")}</span>
                    <span class="settings-v2-server-dialog-error">{result().error}</span>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={() => dialog.close()}>
          {language.t("dialog.mcp.form.cancel")}
        </ButtonV2>
        <ButtonV2 variant="neutral" disabled={busy()} onClick={runTest}>
          {testing() ? language.t("dialog.mcp.form.testing") : language.t("dialog.mcp.form.test")}
        </ButtonV2>
        <ButtonV2 variant="contrast" disabled={busy()} onClick={submit}>
          {language.t("dialog.mcp.form.save")}
        </ButtonV2>
      </DialogFooter>
    </Dialog>
  )
}
