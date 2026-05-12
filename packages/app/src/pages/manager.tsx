import type { Message, Part } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { createEffect, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useModels } from "@/context/models"
import { Identifier } from "@/utils/id"

const managerSessionID = "ses_manager_agent"
const managerTitle = "管理agent"
const proxyStorageKey = "opencode.manager.proxy"

type WithParts = {
  info: Message
  parts: Part[]
}

function partText(part: Part) {
  if (part.type === "text") return part.text
  return ""
}

function messageText(message: WithParts) {
  return message.parts.map(partText).filter(Boolean).join("\n").trim()
}

function loadProxy() {
  try {
    return localStorage.getItem(proxyStorageKey) ?? ""
  } catch {
    return ""
  }
}

function saveProxy(value: string) {
  try {
    localStorage.setItem(proxyStorageKey, value)
  } catch {
    return
  }
}

export default function ManagerPage() {
  const sdk = useGlobalSDK()
  const models = useModels()
  const [proxy, setProxy] = createSignal(loadProxy())
  const [draft, setDraft] = createSignal("")
  const [selected, setSelected] = createSignal("")
  const [error, setError] = createSignal("")
  const [sending, setSending] = createSignal(false)

  const modelOptions = () =>
    models
      .list()
      .filter((model) => models.visible({ providerID: model.provider.id, modelID: model.id }))
      .map((model) => ({
        key: `${model.provider.id}/${model.id}`,
        providerID: model.provider.id,
        modelID: model.id,
        label: `${model.provider.name} / ${model.name}`,
      }))

  createEffect(() => {
    if (selected()) return
    const first = modelOptions()[0]
    if (first) setSelected(first.key)
  })

  const selectedModel = () => modelOptions().find((model) => model.key === selected())

  const ensureSession = async () => {
    await sdk.client.session.get({ sessionID: managerSessionID }).catch(async () => {
      await sdk.client.session.create({ id: managerSessionID, title: managerTitle, agent: "build" })
    })
    return true
  }

  const [ready] = createResource(ensureSession)
  const [messages, messagesAction] = createResource(
    () => ready(),
    async () => {
      const result = await sdk.client.session.messages({ sessionID: managerSessionID })
      return result.data ?? []
    },
    { initialValue: [] as WithParts[] },
  )

  const interval = setInterval(() => {
    if (ready()) void messagesAction.refetch()
  }, 1500)
  onCleanup(() => clearInterval(interval))

  const submit = async () => {
    const text = draft().trim()
    const model = selectedModel()
    if (!text || !model || sending()) return
    setSending(true)
    setError("")
    setDraft("")
    try {
      await sdk.client.session.promptAsync({
        sessionID: managerSessionID,
        agent: "build",
        messageID: Identifier.ascending("message"),
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
        },
        parts: [
          {
            id: Identifier.ascending("part"),
            type: "text",
            text,
          },
        ],
      })
      await messagesAction.refetch()
    } catch (err) {
      setDraft(text)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  return (
    <main class="min-h-dvh bg-background-base text-text-base flex flex-col">
      <header class="border-b border-border-weak-base px-4 py-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div class="flex flex-col gap-1">
          <h1 class="text-18-medium text-text-strong">{managerTitle}</h1>
          <p class="text-12-regular text-text-weak">固定会话：{managerSessionID}</p>
        </div>
        <div class="grid gap-2 md:grid-cols-[260px_340px] md:items-end">
          <label class="flex flex-col gap-1 text-12-medium text-text-base">
            代理地址
            <TextField
              value={proxy()}
              onChange={setProxy}
              onBlur={() => saveProxy(proxy())}
              placeholder="http://127.0.0.1:7890"
            />
          </label>
          <label class="flex flex-col gap-1 text-12-medium text-text-base">
            模型
            <select
              class="h-9 rounded-md bg-surface-base border border-border-weak-base px-2 text-13-regular text-text-strong"
              value={selected()}
              onChange={(event) => setSelected(event.currentTarget.value)}
            >
              <For each={modelOptions()}>
                {(model) => <option value={model.key}>{model.label}</option>}
              </For>
            </select>
          </label>
        </div>
      </header>
      <Show when={proxy()}>
        <div class="px-4 py-2 bg-surface-base border-b border-border-weak-base text-12-regular text-text-weak">
          代理地址已保存到本地设置。当前 sidecar 仍通过环境变量读取代理，重启生效入口待接入。
        </div>
      </Show>
      <section class="flex-1 overflow-y-auto px-4 py-4">
        <Show
          when={!messages.loading}
          fallback={<div class="text-14-regular text-text-weak">正在加载管理会话...</div>}
        >
          <div class="mx-auto max-w-3xl flex flex-col gap-3">
            <Show when={messages().length > 0} fallback={<div class="text-14-regular text-text-weak">开始和管理 agent 对话。</div>}>
              <For each={messages()}>
                {(message) => {
                  const text = messageText(message)
                  return (
                    <Show when={text}>
                      <div
                        class={`rounded-xl px-4 py-3 whitespace-pre-wrap text-14-regular leading-6 ${
                          message.info.role === "user"
                            ? "bg-surface-raised-base ml-8 text-text-strong"
                            : "bg-surface-base mr-8 text-text-base"
                        }`}
                      >
                        {text}
                      </div>
                    </Show>
                  )
                }}
              </For>
            </Show>
          </div>
        </Show>
      </section>
      <footer class="border-t border-border-weak-base p-4">
        <div class="mx-auto max-w-3xl flex flex-col gap-2">
          <Show when={error()}>
            <div class="text-12-regular text-danger-base">{error()}</div>
          </Show>
          <div class="flex gap-2">
            <TextField
              value={draft()}
              onChange={setDraft}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return
                event.preventDefault()
                void submit()
              }}
              placeholder="输入要管理的事项..."
              disabled={!ready() || sending()}
              class="flex-1"
            />
            <Button onClick={() => void submit()} disabled={!draft().trim() || !selectedModel() || sending()}>
              {sending() ? "发送中" : "发送"}
            </Button>
          </div>
        </div>
      </footer>
    </main>
  )
}
