import { For, Show, createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { SegmentedControl, SegmentedControlItem } from "@opencode/ui/segmented-control"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { Textarea } from "@opencode/ui/textarea"
import { Tooltip } from "@opencode/ui/tooltip"
import { Switch } from "@opencode/ui/switch"
import { Spinner } from "@opencode/ui/spinner"
import { uuid } from "@opencode/util/uuid"
import { useLanguage } from "@/runtime/i18n/language"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import type { DesignProjectTarget } from "../project"
import {
  UI_ACCENTS,
  UI_TEMPLATES,
  createUiDocument,
  interpretUiPrompt,
  parseUiDocument,
  type UiDocument,
  type UiSection,
  type UiTemplate,
  type UiTheme,
} from "./model"
import { renderUiDocument } from "./render"
import { downloadExport } from "../scene/export"
import { extractJson, uiPrompt } from "../ai"
import "./designer.css"

const STORAGE_KEY = "opencode.design.ui.v1"

export type UiProjectBridge = {
  target: Accessor<DesignProjectTarget | undefined>
  targets: Accessor<DesignProjectTarget[]>
  select: (target: DesignProjectTarget | null | undefined) => void
  add: () => void
  openHome: () => void
  folder: Accessor<string>
  setFolder: (value: string) => void
  write: (filename: string, payload: Uint8Array, folder: string) => Promise<string>
  generate: (prompt: string) => Promise<string>
}

type Message = { id: string; role: "user" | "system"; text: string; ok?: boolean }

type Device = "desktop" | "tablet" | "phone"

export function UiDesigner(props: { project: UiProjectBridge }) {
  const language = useLanguage()
  const [document, setDocument] = createStore<UiDocument>(loadDocument())
  const [prompt, setPrompt] = createSignal("")
  const [promptMode, setPromptMode] = createSignal<"local" | "ai">("ai")
  const [generating, setGenerating] = createSignal(false)

  const [messages, setMessages] = createSignal<Message[]>([
    { id: uuid(), role: "system", text: language.t("design.ui.chat.welcome"), ok: true },
  ])

  const [device, setDevice] = createSignal<Device>("desktop")
  const [previous, setPrevious] = createSignal<UiDocument>()
  const [saving, setSaving] = createSignal(false)
  const [status, setStatus] = createSignal<{ text: string; ok: boolean }>()
  const [copied, setCopied] = createSignal(false)
  let messagesElement: HTMLDivElement | undefined

  const html = createMemo(() => renderUiDocument(document))

  const scrollMessages = () => {
    queueMicrotask(() => {
      if (messagesElement) messagesElement.scrollTop = messagesElement.scrollHeight
    })
  }

  const push = (role: Message["role"], text: string, ok?: boolean) => {
    setMessages((current) => [...current.slice(-40), { id: uuid(), role, text, ok }])
    scrollMessages()
  }

  const remember = () => setPrevious(structuredClone(unwrap(document)))

  const apply = (next: UiDocument) => {
    remember()
    setDocument(reconcile(next))
  }

  const runPrompt = async () => {
    const value = prompt().trim()

    if (!value || generating()) return
    push("user", value)
    setPrompt("")

    if (promptMode() === "local") {
      const outcome = interpretUiPrompt(unwrap(document), value)

      if (outcome.ok) {
        remember()
        setDocument(reconcile(outcome.document))
      }

      push("system", language.t(outcome.notice.key, outcome.notice.params), outcome.ok)

      return
    }

    setGenerating(true)

    try {
      const request = uiPrompt(unwrap(document), value)
      const text = await props.project.generate(request)
      const next =
        parseUiDocument(extractJson(text)) ??
        parseUiDocument(
          extractJson(
            await props.project.generate(
              `${request}\n\nYour previous response could not be parsed. Return only the complete JSON object.`,
            ),
          ),
        )

      if (!next) throw new Error(language.t("design.ai.invalid"))
      remember()
      setDocument(reconcile(next))
      push("system", language.t("design.ui.notice.aiUpdated"), true)
    } catch (cause) {
      push("system", `${language.t("design.ui.notice.aiFailed")} ${errorMessage(cause, "")}`.trim(), false)
    } finally {
      setGenerating(false)
    }
  }

  const useTemplate = (template: UiTemplate) => {
    apply(createUiDocument(template, document.title))
    push("system", language.t("design.ui.notice.created", { template }), true)
  }

  const undo = () => {
    const snapshot = previous()

    if (!snapshot) return
    setPrevious(undefined)
    setDocument(reconcile(snapshot))
    push("system", language.t("design.ui.notice.updated"), true)
  }

  const setTheme = (patch: Partial<UiTheme>, record = false) => {
    if (record) remember()
    setDocument("theme", patch)
  }

  const removeSection = (section: UiSection) => {
    apply({ ...unwrap(document), sections: document.sections.filter((item) => item.id !== section.id) })
    push("system", language.t("design.ui.notice.removed", { section: section.kind }), true)
  }

  const save = async () => {
    const target = props.project.target()

    if (!target) return
    setSaving(true)
    setStatus(undefined)

    try {
      const path = await props.project.write(fileName(document), new TextEncoder().encode(html()), props.project.folder())

      setStatus({ text: language.t("design.save.saved", { path }), ok: true })
    } catch (cause) {
      const text = errorMessage(cause, language.t("design.ui.saveFailed"))
      setStatus({ text, ok: false })
    } finally {
      setSaving(false)
    }
  }

  const download = () => {
    downloadExport(html(), fileName(document), "text/html")
    showToast({ variant: "success", title: language.t("design.export.done", { name: fileName(document) }), icon: "download" })
  }

  const open = () => {
    const url = URL.createObjectURL(new Blob([html()], { type: "text/html" }))
    window.open(url, "_blank", "noopener,noreferrer")
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const copy = async () => {
    if (!navigator.clipboard?.writeText) {
      showToast({ variant: "error", title: language.t("design.ui.copyFailed") })

      return
    }

    try {
      await navigator.clipboard.writeText(html())
      setCopied(true)
      showToast({ variant: "success", title: language.t("common.copied"), icon: "check" })
      setTimeout(() => setCopied(false), 1800)
    } catch {
      showToast({ variant: "error", title: language.t("design.ui.copyFailed") })
    }
  }

  createEffect(() => {
    const value = JSON.stringify(document)
    const timer = setTimeout(() => localStorage.setItem(STORAGE_KEY, value), 250)

    onCleanup(() => clearTimeout(timer))
  })

  return (
    <div data-slot="ui-designer" class="flex min-h-0 min-w-0 flex-1">
      <aside data-slot="ui-designer-chat">
        <div class="flex h-9 shrink-0 items-center justify-between px-3">
          <span class="text-[12px] font-medium text-v2-text-text-muted">{language.t("design.ui.chat")}</span>
          <span class="text-[11px] text-v2-text-text-faint">{language.t("design.ui.mode")}</span>
        </div>

        <div class="px-2 pb-2">
          <div class="mb-1.5 px-1 text-[11px] font-[530] text-v2-text-text-faint">
            {language.t("design.ui.templates")}
          </div>
          <div class="grid grid-cols-2 gap-1">
            <For each={UI_TEMPLATES}>
              {(template) => (
                <Button
                  type="button"
                  size="small"
                  variant={document.template === template ? "neutral" : "ghost-muted"}
                  class="justify-start"
                  onClick={() => useTemplate(template)}
                >
                  {language.t(templateKey(template))}
                </Button>
              )}
            </For>
          </div>
        </div>

        <div ref={messagesElement} data-slot="ui-chat-messages" data-scrollable class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <For each={messages()}>
            {(message) => (
              <div
                data-slot="ui-chat-message"
                data-role={message.role}
                class="mb-1.5 rounded-[6px] px-2 py-1.5 text-[12px] leading-4"
                classList={{
                  "ms-5 bg-v2-background-bg-layer-02 text-v2-text-text-base": message.role === "user",
                  "me-2 bg-v2-background-bg-layer-01 text-v2-text-text-muted": message.role === "system",
                  "text-v2-state-fg-danger": message.ok === false,
                }}
              >
                {message.text}
              </div>
            )}
          </For>
        </div>

        <div data-slot="design-prompt">
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <span class="text-[12px] font-medium text-v2-text-text-muted">{language.t("design.ui.promptTitle")}</span>
            <Tooltip placement="top" value={language.t("design.prompt.aiHint")}>
              <Switch
                appearance="compact"
                checked={promptMode() === "ai"}
                onChange={(ai) => setPromptMode(ai ? "ai" : "local")}
              >
                {language.t("design.prompt.ai")}
              </Switch>
            </Tooltip>
          </div>
          <Textarea
            rows={3}
            value={prompt()}
            placeholder={language.t("design.ui.placeholder")}
            onInput={(event) => setPrompt(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return
              event.preventDefault()
              void runPrompt()
            }}
          />
          <div class="mt-1.5 flex items-center gap-1">
            <button
              type="button"
              class="text-[11px] text-v2-text-text-faint underline-offset-2 hover:text-v2-text-text-muted hover:underline"
              onClick={() => setPrompt(language.t("design.ui.example"))}
            >
              {language.t("design.ui.exampleShort")}
            </button>
            <div class="flex-1" />
            <Button
              type="button"
              size="small"
              variant="contrast"
              disabled={!prompt().trim() || generating()}
              onClick={() => void runPrompt()}
            >
              <Show when={generating()} fallback={language.t("design.prompt.run")}>
                <Spinner class="size-3" />
                {language.t("design.prompt.generating")}
              </Show>
            </Button>
          </div>
        </div>
      </aside>

      <main data-slot="ui-preview">
        <div data-slot="ui-preview-toolbar">
          <SegmentedControl value={device()} onChange={(value) => value && setDevice(value as Device)}>
            <SegmentedControlItem value="desktop">{language.t("design.ui.device.desktop")}</SegmentedControlItem>
            <SegmentedControlItem value="tablet">{language.t("design.ui.device.tablet")}</SegmentedControlItem>
            <SegmentedControlItem value="phone">{language.t("design.ui.device.phone")}</SegmentedControlItem>
          </SegmentedControl>
          <div class="flex-1" />
          <Show when={previous()}>
            <Tooltip placement="bottom" value={language.t("design.action.undo")}>
              <IconButton
                type="button"
                size="small"
                variant="ghost-muted"
                aria-label={language.t("design.action.undo")}
                icon={<Icon name="outline-undo" />}
                onClick={undo}
              />
            </Tooltip>
          </Show>
          <Tooltip placement="bottom" value={language.t("design.ui.copy")}>
            <IconButton
              type="button"
              size="small"
              variant="ghost-muted"
              aria-label={language.t("design.ui.copy")}
              icon={<Icon name={copied() ? "check" : "outline-copy"} />}
              onClick={() => void copy()}
            />
          </Tooltip>
          <Tooltip placement="bottom" value={language.t("design.ui.open")}>
            <IconButton
              type="button"
              size="small"
              variant="ghost-muted"
              aria-label={language.t("design.ui.open")}
              icon={<Icon name="outline-arrow-up-right" />}
              onClick={open}
            />
          </Tooltip>
          <Button type="button" size="small" variant="neutral" icon="download" onClick={download}>
            {language.t("design.ui.download")}
          </Button>
        </div>

        <div data-slot="ui-preview-stage" data-device={device()}>
          <div data-slot="ui-preview-frame">
            <iframe
              data-slot="ui-preview-iframe"
              title={document.title}
              sandbox=""
              srcdoc={html()}
            />
          </div>
        </div>
      </main>

      <aside data-slot="ui-designer-inspector">
        <div class="flex h-9 shrink-0 items-center px-3">
          <span class="text-[12px] font-medium text-v2-text-text-muted">{language.t("design.inspector")}</span>
        </div>

        <div data-scrollable class="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <div data-slot="design-field-label" class="text-[11px] font-[530] leading-4 text-v2-text-text-faint">
            {language.t("design.ui.pageTitle")}
          </div>
          <TextInput
            class="mt-1"
            appearance="small"
            value={document.title}
            onChange={(event) => {
              remember()
              setDocument("title", event.currentTarget.value.trim() || document.title)
            }}
          />

          <div data-slot="design-field-label" class="mt-4 text-[11px] font-[530] leading-4 text-v2-text-text-faint">
            {language.t("design.ui.theme")}
          </div>
          <SegmentedControl
            class="mt-1.5"
            value={document.theme.mode}
            onChange={(value) => value && setTheme({ mode: value as UiTheme["mode"] }, true)}
          >
            <SegmentedControlItem value="light">{language.t("design.ui.light")}</SegmentedControlItem>
            <SegmentedControlItem value="dark">{language.t("design.ui.dark")}</SegmentedControlItem>
          </SegmentedControl>

          <div data-slot="design-field-label" class="mt-3 text-[11px] font-[530] leading-4 text-v2-text-text-faint">
            {language.t("design.ui.accent")}
          </div>
          <div class="mt-1.5 grid grid-cols-7 gap-1.5">
            <For each={UI_ACCENTS}>
              {(color) => (
                <button
                  type="button"
                  class="aspect-square rounded-[4px] border outline-none ring-offset-1 focus-visible:ring-1 focus-visible:ring-v2-border-border-focus"
                  classList={{
                    "border-v2-text-text-base ring-1 ring-v2-text-text-base": document.theme.accent === color,
                    "border-v2-border-border-strong": document.theme.accent !== color,
                  }}
                  style={{ "background-color": color }}
                  aria-label={color}
                  onClick={() => setTheme({ accent: color }, true)}
                />
              )}
            </For>
          </div>

          <div data-slot="design-field-label" class="mt-3 text-[11px] font-[530] leading-4 text-v2-text-text-faint">
            {language.t("design.ui.font")}
          </div>
          <SegmentedControl
            class="mt-1.5"
            value={document.theme.font}
            onChange={(value) => value && setTheme({ font: value as UiTheme["font"] }, true)}
          >
            <SegmentedControlItem value="sans">{language.t("design.ui.font.sans")}</SegmentedControlItem>
            <SegmentedControlItem value="serif">{language.t("design.ui.font.serif")}</SegmentedControlItem>
            <SegmentedControlItem value="mono">{language.t("design.ui.font.mono")}</SegmentedControlItem>
          </SegmentedControl>

          <label class="mt-3 flex items-center gap-2">
            <span class="w-[64px] shrink-0 text-[11px] leading-4 text-v2-text-text-faint">
              {language.t("design.ui.radius")}
            </span>
            <input
              data-slot="design-range"
              type="range"
              min={0}
              max={28}
              step={1}
              value={document.theme.radius}
              onPointerDown={() => remember()}
              onKeyDown={() => remember()}
              onInput={(event) => setTheme({ radius: Number(event.currentTarget.value) })}
              aria-label={language.t("design.ui.radius")}
            />
            <span class="w-6 shrink-0 text-end text-[10px] tabular-nums text-v2-text-text-faint">
              {document.theme.radius}
            </span>
          </label>

          <div class="mt-4 border-t border-v2-border-border-muted pt-3">
            <div data-slot="design-field-label" class="text-[11px] font-[530] leading-4 text-v2-text-text-faint">
              {language.t("design.ui.sections")}
            </div>
            <div class="mt-1.5 flex flex-col gap-0.5">
              <For each={document.sections}>
                {(section) => (
                  <div class="group flex h-7 items-center gap-2 rounded-[5px] px-1.5 text-[12px] text-v2-text-text-muted hover:bg-v2-background-bg-layer-02">
                    <span class="size-1.5 rounded-full bg-v2-text-text-faint" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate">{language.t(sectionKey(section.kind))}</span>
                    <IconButton
                      type="button"
                      size="small"
                      variant="ghost-muted"
                      class="hover-reveal"
                      aria-label={language.t("design.action.delete")}
                      icon={<Icon name="xmark-small" size="small" />}
                      onClick={() => removeSection(section)}
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>

        <div data-slot="design-save">
          <div class="flex items-center justify-between gap-2">
            <div data-slot="design-field-label" class="text-[11px] font-[530] leading-4 text-v2-text-text-faint">
              {language.t("design.project")}
            </div>
            <button
              type="button"
              class="text-[11px] text-v2-text-text-accent underline-offset-2 hover:underline"
              onClick={props.project.add}
            >
              {language.t("design.project.add")}
            </button>
          </div>
          <Show
            when={props.project.target()}
            fallback={
              <div class="mt-1.5 rounded-[5px] border border-dashed border-v2-border-border-muted px-2 py-2 text-[11px] leading-4 text-v2-text-text-faint">
                {language.t("design.project.none")}{" "}
                <button
                  type="button"
                  class="text-v2-text-text-accent underline-offset-2 hover:underline"
                  onClick={props.project.openHome}
                >
                  {language.t("design.project.openHome")}
                </button>
              </div>
            }
          >
            {(target) => (
              <>
                <Select
                  class="mt-1.5 w-full"
                  options={props.project.targets()}
                  current={target()}
                  value={(item) => item.key}
                  label={(item) => item.label}
                  onSelect={props.project.select}
                  aria-label={language.t("design.project.select")}
                >
                  {(item) => (
                    <span class="flex min-w-0 items-center gap-2">
                      <span class="truncate">{item.label}</span>
                      <Show when={item.serverLabel}>
                        <span class="truncate text-[11px] text-v2-text-text-faint">{item.serverLabel}</span>
                      </Show>
                    </span>
                  )}
                </Select>
                <TextInput
                  class="mt-1.5"
                  appearance="small"
                  value={props.project.folder()}
                  placeholder={language.t("design.project.folder")}
                  onChange={(event) => props.project.setFolder(event.currentTarget.value)}
                  aria-label={language.t("design.project.folder")}
                />
                <Button
                  type="button"
                  size="small"
                  variant="contrast"
                  class="mt-2 w-full"
                  disabled={saving()}
                  onClick={() => void save()}
                >
                  {language.t("design.ui.save")}
                </Button>
                <Show when={status()}>
                  {(value) => (
                    <div
                      class="mt-1.5 break-words text-[11px] leading-4"
                      classList={{
                        "text-v2-state-fg-danger": !value().ok,
                        "text-v2-state-fg-success": value().ok,
                      }}
                    >
                      {value().text}
                    </div>
                  )}
                </Show>
              </>
            )}
          </Show>
        </div>
      </aside>
    </div>
  )
}

function loadDocument(): UiDocument {
  const raw = typeof localStorage === "object" ? localStorage.getItem(STORAGE_KEY) : undefined

  if (!raw) return createUiDocument("landing")

  try {
    return parseUiDocument(JSON.parse(raw)) ?? createUiDocument("landing")
  } catch {
    return createUiDocument("landing")
  }
}

function fileName(document: UiDocument) {
  const slug = document.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return `${slug || "design"}.html`
}

function templateKey(template: UiTemplate) {
  return `design.ui.template.${template}` as const
}

function sectionKey(kind: UiSection["kind"]) {
  return `design.ui.section.${kind}` as const
}
