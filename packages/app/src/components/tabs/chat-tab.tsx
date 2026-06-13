import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import type { Message, Part, Session } from "@cedric/sdk/v2/client"
import { Button } from "@cedric/ui/button"
import { Icon } from "@cedric/ui/icon"
import { IconButton } from "@cedric/ui/icon-button"
import { Markdown } from "@cedric/ui/markdown"
import { ProviderIcon } from "@cedric/ui/provider-icon"
import { ScrollView } from "@cedric/ui/scroll-view"
import { Select } from "@cedric/ui/select"
import { ModelSelectorPopover } from "@/components/dialog-select-model"
import { sendFollowupDraft } from "@/components/prompt-input/submit"
import { browserAnnotationsText, type BrowserAnnotation } from "@/components/tabs/browser-tab"
import { useLanguage } from "@/context/language"
import { useLocal } from "@/context/local"
import { useSDK } from "@/context/sdk"
import { useServerSync } from "@/context/server-sync"
import { useSync } from "@/context/sync"
import { formatServerError } from "@/utils/server-errors"
import { sessionTitle } from "@/utils/session-title"
import { showToast } from "@/utils/toast"

type ChatTabProps = {
  active: boolean
  title: string
  sessionID?: string
  agent?: string
  modelProviderID?: string
  modelID?: string
  modelVariant?: string
  contextUrl?: string
  contextTitle?: string
  contextAnnotations?: BrowserAnnotation[]
  contextFilePath?: string
  onSessionChange: (sessionID: string) => void
  onTitleChange: (title: string) => void
  onSelectionChange: (selection: {
    agent?: string
    modelProviderID?: string
    modelID?: string
    modelVariant?: string
  }) => void
  onContextChange: (context: {
    contextUrl?: string
    contextTitle?: string
    contextAnnotations?: BrowserAnnotation[]
    contextFilePath?: string
  }) => void
  onSendDraftToMainChat?: (text: string) => void
}

const emptyMessages: Message[] = []
const emptyParts: Part[] = []
const idle = { type: "idle" } as const
const defaultVariant = "default"

type ModelState = ReturnType<typeof useLocal>["model"]
type ModelKey = { providerID: string; modelID: string }

function contextLabel(title: string | undefined, url: string) {
  const value = title?.trim() || url
  if (value.length <= 40) return value
  return `${value.slice(0, 37).trim()}...`
}

function browserContextText(input: { title?: string; url: string; annotations?: BrowserAnnotation[] }) {
  const annotations = browserAnnotationsText(input.annotations ?? [])
  return [
    "<browser-context>",
    ...(input.title ? [`Title: ${input.title}`] : []),
    `URL: ${input.url}`,
    ...(annotations ? [annotations] : []),
    "</browser-context>",
  ].join("\n")
}

function fileContextKey(path: string) {
  return `side-chat-file:${path}`
}

function previewTitle(value: string) {
  const title = value.trim().replace(/\s+/g, " ")
  if (!title) return "Side Chat"
  if (title.length <= 48) return title
  return `${title.slice(0, 45).trim()}...`
}

function partText(part: Part) {
  if (part.type === "text" || part.type === "reasoning") return part.text
  if (part.type === "file") return part.filename ?? part.url
  if (part.type === "agent") return `@${part.name}`
  if (part.type === "tool") {
    if (part.state.status === "completed") return part.state.title || part.tool
    if (part.state.status === "error") return part.state.error
    return "title" in part.state && part.state.title ? part.state.title : part.tool
  }
  if (part.type === "subtask") return part.description || part.prompt
  if (part.type === "retry") return part.error.data.message
  if (part.type === "compaction") return part.overflow ? "Compacted conversation after overflow" : "Compacted conversation"
  if (part.type === "snapshot") return "Captured snapshot"
  if (part.type === "patch") return `${part.files.length} changed ${part.files.length === 1 ? "file" : "files"}`
  return ""
}

function messageError(message: Message): string | undefined {
  if (message.role !== "assistant" || !message.error) return undefined
  const data = message.error.data as { message?: unknown }
  return typeof data.message === "string" ? data.message : message.error.name
}

function MessageBubble(props: { message: Message; parts: Part[] }) {
  const text = createMemo(() =>
    props.parts
      .filter((part) => part.type === "text" && !part.ignored && !part.synthetic)
      .map(partText)
      .filter(Boolean)
      .join("\n\n"),
  )
  const reasoning = createMemo(() =>
    props.parts
      .filter((part) => part.type === "reasoning")
      .map(partText)
      .filter(Boolean)
      .join("\n\n"),
  )
  const secondary = createMemo(() =>
    props.parts
      .filter((part) => part.type !== "text" && part.type !== "reasoning")
      .map((part) => ({ id: part.id, label: partText(part), type: part.type }))
      .filter((part) => !!part.label),
  )
  const error = createMemo(() => messageError(props.message))
  const assistant = () => props.message.role === "assistant"

  return (
    <div class="flex w-full" classList={{ "justify-end": !assistant(), "justify-start": assistant() }}>
      <div
        class="max-w-[92%] min-w-0 rounded-md px-3 py-2 text-13-regular leading-5"
        classList={{
          "bg-background-stronger text-text-base": !assistant(),
          "border border-border-weaker-base bg-background-base text-text-base": assistant(),
        }}
      >
        <Show when={reasoning()}>
          {(value) => <div class="mb-2 text-12-regular text-text-weak italic">{value()}</div>}
        </Show>

        <Show when={text()} fallback={<Show when={secondary().length === 0 && !error()}>...</Show>}>
          {(value) => <Markdown text={value()} class="text-13-regular" />}
        </Show>

        <Show when={secondary().length > 0}>
          <div class="mt-2 flex flex-wrap gap-1">
            <For each={secondary()}>
              {(part) => (
                <div class="rounded bg-background-stronger px-1.5 py-0.5 text-11-regular text-text-weak">
                  {part.type}: {part.label}
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={error()}>
          {(value) => <div class="mt-2 text-12-regular text-syntax-error">{value()}</div>}
        </Show>
      </div>
    </div>
  )
}

export function ChatTab(props: ChatTabProps) {
  const sdk = useSDK()
  const sync = useSync()
  const serverSync = useServerSync()
  const local = useLocal()
  const language = useLanguage()

  const [draft, setDraft] = createSignal("")
  const [sending, setSending] = createSignal(false)
  let scroll: HTMLDivElement | undefined
  let textarea: HTMLTextAreaElement | undefined
  let lastTitle = props.title

  const messages = createMemo(() => (props.sessionID ? (sync.data.message[props.sessionID] ?? emptyMessages) : emptyMessages))
  const status = createMemo(() => (props.sessionID ? (sync.data.session_status[props.sessionID] ?? idle) : idle))
  const working = createMemo(() => status().type !== "idle")
  const blank = createMemo(() => draft().trim().length === 0)
  const browserContext = createMemo(() => {
    const url = props.contextUrl?.trim()
    if (!url) return undefined
    return { url, title: props.contextTitle?.trim() || undefined, annotations: props.contextAnnotations ?? [] }
  })
  const fileContext = createMemo(() => {
    const path = props.contextFilePath?.trim()
    if (!path) return undefined
    return { path }
  })
  const getParts = (messageID: string) => sync.data.part[messageID] ?? emptyParts
  const agents = createMemo(() => local.agent.list())
  const agentNames = createMemo(() => agents().map((agent) => agent.name))
  const selectedAgent = createMemo(() => {
    const saved = props.agent ? agents().find((agent) => agent.name === props.agent) : undefined
    return saved ?? local.agent.current() ?? agents()[0]
  })
  const savedModel = createMemo<ModelKey | undefined>(() => {
    if (!props.modelProviderID || !props.modelID) return undefined
    return { providerID: props.modelProviderID, modelID: props.modelID }
  })
  const findModel = (key: ModelKey | undefined) => {
    if (!key) return undefined
    return local.model.list().find((model) => model.provider.id === key.providerID && model.id === key.modelID)
  }
  const selectedModel = createMemo(() => {
    const saved = findModel(savedModel())
    if (saved) return saved

    const agentModel = selectedAgent()?.model
    const fromAgent = findModel(agentModel ? { providerID: agentModel.providerID, modelID: agentModel.modelID } : undefined)
    if (fromAgent) return fromAgent

    return local.model.current()
  })
  const modelVariants = createMemo(() => Object.keys(selectedModel()?.variants ?? {}))
  const selectedVariant = createMemo(() => {
    if (props.modelVariant && modelVariants().includes(props.modelVariant)) return props.modelVariant
    const agentVariant = selectedAgent()?.variant
    if (!savedModel() && agentVariant && modelVariants().includes(agentVariant)) return agentVariant
    return undefined
  })
  const variantOptions = createMemo(() => [defaultVariant, ...modelVariants()])

  const chatModel = {
    ready: local.model.ready,
    current: selectedModel,
    recent: local.model.recent,
    list: local.model.list,
    cycle(direction) {
      const items = chatModel.recent()
      const current = chatModel.current()
      if (!current) return

      const index = items.findIndex((item) => item?.provider.id === current.provider.id && item?.id === current.id)
      if (index === -1) return

      const next = index + direction < 0 ? items.length - 1 : index + direction >= items.length ? 0 : index + direction
      const item = items[next]
      if (!item) return
      chatModel.set({ providerID: item.provider.id, modelID: item.id })
    },
    set(item) {
      props.onSelectionChange({
        modelProviderID: item?.providerID,
        modelID: item?.modelID,
        modelVariant: undefined,
      })
    },
    visible(item) {
      return local.model.visible(item)
    },
    setVisibility(item, visible) {
      local.model.setVisibility(item, visible)
    },
    variant: {
      configured() {
        const variant = selectedAgent()?.variant
        return variant && modelVariants().includes(variant) ? variant : undefined
      },
      selected() {
        return props.modelVariant
      },
      current: selectedVariant,
      list: modelVariants,
      set(value) {
        props.onSelectionChange({ modelVariant: value ?? undefined })
      },
      cycle() {
        const current = selectedVariant()
        const options = variantOptions()
        const index = options.findIndex((item) => item === (current ?? defaultVariant))
        const next = options[index + 1] ?? options[0]
        props.onSelectionChange({ modelVariant: next === defaultVariant ? undefined : next })
      },
    },
  } satisfies ModelState

  const selectAgent = (name: string | undefined) => {
    const agent = agents().find((item) => item.name === name)
    if (!agent) return
    props.onSelectionChange({
      agent: agent.name,
      modelProviderID: agent.model?.providerID ?? props.modelProviderID,
      modelID: agent.model?.modelID ?? props.modelID,
      modelVariant: agent.variant ?? props.modelVariant,
    })
  }

  const setTabTitle = (title: string) => {
    if (title === lastTitle) return
    lastTitle = title
    props.onTitleChange(title)
  }

  const seedSession = (session: Session) => {
    const [, setStore] = serverSync.child(sdk.directory)
    setStore("session", (list: Session[]) => {
      const next = list.some((item) => item.id === session.id)
        ? list.map((item) => (item.id === session.id ? session : item))
        : [...list, session]
      return next.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    })
  }

  const createSession = async () => {
    const created = await sdk.client.session.create().then((response) => response.data)
    if (!created) throw new Error(language.t("prompt.toast.promptSendFailed.description"))
    seedSession(created)
    props.onSessionChange(created.id)
    return created.id
  }

  const abort = async () => {
    if (!props.sessionID) return
    await sdk.client.session.abort({ sessionID: props.sessionID }).catch(() => {})
  }

  const submit = async (event?: Event) => {
    event?.preventDefault()
    if (working() && blank()) {
      await abort()
      return
    }

    const text = draft().trim()
    if (!text || sending()) return

    const currentModel = selectedModel()
    const currentAgent = selectedAgent()
    if (!currentModel || !currentAgent) {
      showToast({
        title: language.t("prompt.toast.modelAgentRequired.title"),
        description: language.t("prompt.toast.modelAgentRequired.description"),
      })
      return
    }

    setSending(true)
    setDraft("")
    setTabTitle(previewTitle(text))

    try {
      const sessionID = props.sessionID ?? (await createSession())
      const browser = browserContext()
      const file = fileContext()
      await sendFollowupDraft({
        client: sdk.client,
        serverSync,
        sync,
        optimisticBusy: true,
        draft: {
          sessionID,
          sessionDirectory: sdk.directory,
          prompt: [{ type: "text", content: text, start: 0, end: text.length }],
          context: file ? [{ key: fileContextKey(file.path), type: "file", path: file.path }] : [],
          synthetic: browser
            ? [
                {
                  text: browserContextText(browser),
                  metadata: { cedricBrowserContext: browser },
                },
              ]
            : undefined,
          agent: currentAgent.name,
          model: { providerID: currentModel.provider.id, modelID: currentModel.id },
          variant: selectedVariant(),
        },
      })
      if (browser || file) {
        props.onContextChange({
          contextUrl: undefined,
          contextTitle: undefined,
          contextAnnotations: undefined,
          contextFilePath: undefined,
        })
      }
      requestAnimationFrame(() => textarea?.focus())
    } catch (err) {
      setDraft(text)
      showToast({
        title: language.t("prompt.toast.promptSendFailed.title"),
        description: formatServerError(err, language.t, language.t("common.requestFailed")),
      })
    } finally {
      setSending(false)
    }
  }

  const sendDraftToMainChat = () => {
    const text = draft().trim()
    if (!text) return
    props.onSendDraftToMainChat?.(text)
  }

  createEffect(() => {
    if (!props.active || !props.sessionID) return
    void sync.session.sync(props.sessionID)
  })

  createEffect(() => {
    if (!props.sessionID) return
    const title = sessionTitle(sync.session.get(props.sessionID)?.title)
    if (title) setTabTitle(title)
  })

  createEffect(() => {
    messages().length
    working()
    requestAnimationFrame(() => {
      if (!scroll || !props.active) return
      scroll.scrollTop = scroll.scrollHeight
    })
  })

  return (
    <div class="flex h-full min-h-0 flex-col bg-background-base">
      <div class="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border-weaker-base px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <Icon name="comment" size="small" class="shrink-0 text-syntax-type" />
          <div class="min-w-0 truncate text-13-medium text-text-base">{props.title}</div>
        </div>
        <div class="flex min-w-0 shrink-0 items-center justify-end gap-1">
          <Show when={agentNames().length > 0}>
            <Select
              size="normal"
              options={agentNames()}
              current={selectedAgent()?.name ?? ""}
              onSelect={selectAgent}
              class="max-w-[120px] capitalize text-text-base"
              valueClass="truncate text-12-regular text-text-base"
              variant="ghost"
              triggerProps={{ "data-action": "side-chat-agent" }}
            />
          </Show>
          <ModelSelectorPopover
            model={chatModel}
            triggerAs={Button}
            triggerProps={{
              variant: "ghost",
              size: "normal",
              class: "min-w-0 max-w-[180px] text-12-regular text-text-base group",
              "data-action": "side-chat-model",
            }}
            onClose={() => textarea?.focus()}
          >
            <Show when={selectedModel()?.provider?.id}>
              <ProviderIcon
                id={selectedModel()?.provider?.id ?? ""}
                class="size-4 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity duration-150"
              />
            </Show>
            <span class="truncate">{selectedModel()?.name ?? language.t("dialog.model.select.title")}</span>
            <Icon name="chevron-down" size="small" class="shrink-0" />
          </ModelSelectorPopover>
          <Show when={modelVariants().length > 0}>
            <Select
              size="normal"
              options={variantOptions()}
              current={selectedVariant() ?? defaultVariant}
              label={(value) => (value === defaultVariant ? language.t("common.default") : value)}
              onSelect={(value) => {
                chatModel.variant.set(value === defaultVariant ? undefined : value)
                textarea?.focus()
              }}
              class="max-w-[120px] capitalize text-text-base"
              valueClass="truncate text-12-regular text-text-base"
              variant="ghost"
              triggerProps={{ "data-action": "side-chat-model-variant" }}
            />
          </Show>
          <Show when={working()}>
            <div class="px-1 text-11-regular text-text-weak">Working</div>
          </Show>
        </div>
      </div>

      <ScrollView
        class="min-h-0 flex-1"
        viewportRef={(el) => {
          scroll = el
        }}
      >
        <div class="flex min-h-full flex-col gap-3 px-3 py-4">
          <Show
            when={messages().length > 0}
            fallback={
              <div class="flex flex-1 items-center justify-center px-6 text-center">
                <div class="max-w-sm space-y-2">
                  <div class="text-14-semibold text-text-base">Side Chat</div>
                  <div class="text-13-regular text-text-weak">
                    Start a separate conversation without leaving the current workspace.
                  </div>
                </div>
              </div>
            }
          >
            <For each={messages()}>{(message) => <MessageBubble message={message} parts={getParts(message.id)} />}</For>
          </Show>
        </div>
      </ScrollView>

      <form class="shrink-0 border-t border-border-weaker-base p-3" onSubmit={submit}>
        <Show when={fileContext()}>
          {(context) => (
            <div class="mb-2 flex min-w-0 items-center gap-2 rounded-md border border-border-weaker-base bg-background-stronger px-2 py-1.5">
              <Icon name="open-file" size="small" class="shrink-0 text-syntax-string" />
              <div class="min-w-0 flex-1 truncate text-12-regular text-text-base">{contextLabel(undefined, context().path)}</div>
              <IconButton
                type="button"
                icon="close-small"
                variant="ghost"
                class="size-5 shrink-0 text-text-weak hover:text-text-base"
                aria-label="Remove file context"
                onClick={() => props.onContextChange({ contextFilePath: undefined })}
              />
            </div>
          )}
        </Show>
        <Show when={browserContext()}>
          {(context) => (
            <div class="mb-2 flex min-w-0 items-center gap-2 rounded-md border border-border-weaker-base bg-background-stronger px-2 py-1.5">
              <Icon name="window-cursor" size="small" class="shrink-0 text-icon-info-active" />
              <div class="min-w-0 flex-1 truncate text-12-regular text-text-base">
                {contextLabel(context().title, context().url)}
                <Show when={context().annotations.length > 0}>
                  <span class="text-text-weak"> · {context().annotations.length} annotations</span>
                </Show>
              </div>
              <IconButton
                type="button"
                icon="close-small"
                variant="ghost"
                class="size-5 shrink-0 text-text-weak hover:text-text-base"
                aria-label="Remove browser context"
                onClick={() =>
                  props.onContextChange({ contextUrl: undefined, contextTitle: undefined, contextAnnotations: undefined })
                }
              />
            </div>
          )}
        </Show>
        <div class="flex items-end gap-2 rounded-md border border-border-weaker-base bg-background-stronger p-2 focus-within:border-border-base">
          <textarea
            ref={(el) => {
              textarea = el
            }}
            rows={1}
            value={draft()}
            placeholder="Ask in side chat..."
            disabled={sending()}
            class="max-h-32 min-h-8 flex-1 resize-none border-0 bg-transparent px-1 py-1 text-13-regular leading-5 text-text-base outline-none placeholder:text-text-weaker disabled:opacity-60"
            onInput={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return
              event.preventDefault()
              void submit()
            }}
          />
          <IconButton
            type="button"
            icon="prompt"
            variant="ghost"
            class="size-8 shrink-0 text-text-weak hover:text-text-base"
            title="Copy draft to Main Chat"
            aria-label="Copy draft to Main Chat"
            disabled={!draft().trim()}
            onClick={sendDraftToMainChat}
          />
          <button
            type="submit"
            disabled={sending() || (!working() && blank())}
            aria-label={working() && blank() ? "Stop" : "Send"}
            class="flex size-8 shrink-0 items-center justify-center rounded-md bg-text-base text-background-base transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-40"
          >
            <Icon name={working() && blank() ? "stop" : "arrow-up"} size="small" />
          </button>
        </div>
      </form>
    </div>
  )
}
