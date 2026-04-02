import { createSignal, createMemo, For, Show, onMount } from "solid-js"
import { type TextareaRenderable } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "../../context/theme"
import { useLocal } from "@tui/context/local"
import type { Message, Part } from "@opencode-ai/sdk/v2"

export function SidekickChat(props: { parentID: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()
  let ref: TextareaRenderable | undefined
  const [sidekickID, setSidekickID] = createSignal<string | undefined>()
  const [sending, setSending] = createSignal(false)

  const base = () => `${sdk.url}/session/${props.parentID}`

  async function ensure() {
    const res = await (sdk.fetch ?? fetch)(`${base()}/sidekick`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    const session = await res.json()
    setSidekickID(session.id)
    await sync.session.sync(session.id)
    return session.id
  }

  onMount(() => {
    ensure()
  })

  const messages = createMemo<Message[]>(() => {
    const id = sidekickID()
    if (!id) return []
    return sync.data.message[id] ?? []
  })

  const parts = (messageID: string): Part[] => {
    return sync.data.part[messageID] ?? []
  }

  async function send() {
    if (!ref) return
    const text = ref.plainText.trim()
    if (!text || sending()) return
    setSending(true)
    ref.setText("")

    const id = sidekickID() ?? (await ensure())

    const model = local.model.current()
    const body: Record<string, unknown> = { text }
    if (model) {
      body.model = {
        providerID: model.providerID,
        modelID: model.modelID,
      }
    }

    await (sdk.fetch ?? fetch)(`${sdk.url}/session/${props.parentID}/sidekick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    // Sync to pick up the new messages
    await sync.session.sync(id)
    setSending(false)
  }

  async function inject(text: string) {
    await (sdk.fetch ?? fetch)(`${base()}/sidekick/inject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
  }

  return (
    <box flexDirection="column" height="100%" gap={1}>
      <box flexShrink={0}>
        <text fg={theme.text}>
          <b>Sidekick</b>
        </text>
      </box>

      <scrollbox
        flexGrow={1}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
        stickyScroll={true}
        stickyStart="bottom"
      >
        <box gap={1} flexShrink={0} paddingRight={1}>
          <Show when={messages().length === 0}>
            <text fg={theme.textMuted}>Start chatting with your sidekick...</text>
          </Show>
          <For each={messages()}>
            {(msg) => {
              const text = createMemo(() =>
                parts(msg.id)
                  .filter((p): p is Part & { type: "text" } => p.type === "text")
                  .map((p) => (p as unknown as { text: string }).text)
                  .join("\n"),
              )
              return (
                <box>
                  <Show when={msg.role === "user"}>
                    <text fg={theme.info}>
                      <b>You: </b>
                      {text()}
                    </text>
                  </Show>
                  <Show when={msg.role === "assistant"}>
                    <box>
                      <text fg={theme.text}>{text()}</text>
                      <Show when={text()}>
                        <box onMouseUp={() => inject(text())}>
                          <text fg={theme.textMuted}>
                            <u>[inject ↑]</u>
                          </text>
                        </box>
                      </Show>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
          <Show when={sending()}>
            <text fg={theme.textMuted}>Thinking...</text>
          </Show>
        </box>
      </scrollbox>

      <box flexShrink={0}>
        <textarea
          ref={ref}
          height={3}
          width="100%"
          placeholder="Chat with sidekick..."
          backgroundColor={theme.backgroundElement}
          textColor={theme.text}
          onSubmit={() => send()}
        />
      </box>
    </box>
  )
}
