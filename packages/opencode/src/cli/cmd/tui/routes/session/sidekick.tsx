import { createSignal, createMemo, For, Show, onMount } from "solid-js"
import { type TextareaRenderable } from "@opentui/core"
import { useSync } from "@tui/context/sync"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "../../context/theme"
import { useLocal } from "@tui/context/local"
import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2"

export function SidekickChat(props: { parentID: string }) {
  const sdk = useSDK()
  const sync = useSync()
  const { theme } = useTheme()
  const local = useLocal()
  let ref: TextareaRenderable | undefined
  const [sidekickID, setSidekickID] = createSignal<string | undefined>()
  const [sending, setSending] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>()

  async function ensure() {
    try {
      const res = await sdk.client.session.sidekick.get({ sessionID: props.parentID })
      if (res.error) {
        setError(`Failed to create sidekick`)
        return undefined
      }
      setSidekickID(res.data.id)
      await sync.session.sync(res.data.id)
      return res.data.id as string
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create sidekick")
      return undefined
    }
  }

  onMount(() => {
    ensure()
  })

  const busy = createMemo(() => {
    const id = sidekickID()
    if (!id) return false
    const status = sync.data.session_status[id]
    return status?.type === "busy" || status?.type === "retry"
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
    if (!text || sending() || busy()) return
    setSending(true)
    setError(undefined)
    ref.setText("")

    try {
      const id = sidekickID() ?? (await ensure())
      if (!id) return

      const model = local.model.current()
      const params: Record<string, unknown> = { sessionID: props.parentID, text }
      if (model) {
        params.model = {
          providerID: model.providerID,
          modelID: model.modelID,
        }
      }

      const res = await sdk.client.session.sidekick.prompt(
        params as Parameters<typeof sdk.client.session.sidekick.prompt>[0],
      )

      if (res.error) {
        setError(`Request failed`)
      }

      // Sync to pick up the new messages
      await sync.session.sync(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send message")
    } finally {
      setSending(false)
    }
  }

  async function reset() {
    try {
      const res = await sdk.client.session.sidekick.reset({ sessionID: props.parentID })
      if (res.error) {
        setError(`Failed to reset sidekick`)
        return
      }
      setSidekickID(undefined)
      setError(undefined)
      await ensure()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset sidekick")
    }
  }

  async function inject(text: string) {
    try {
      const res = await sdk.client.session.sidekick.inject({ sessionID: props.parentID, text })
      if (res.error) {
        setError(`Failed to inject message`)
        return
      }
      setError(undefined)
      await sync.session.sync(props.parentID)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to inject message")
    }
  }

  return (
    <box flexDirection="column" height="100%" gap={1}>
      <box flexShrink={0} flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <b>Sidekick</b>
        </text>
        <box onMouseUp={() => reset()}>
          <text fg={theme.textMuted}>
            <u>[reset]</u>
          </text>
        </box>
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
                  .filter(
                    (p): p is Part & { type: "text" } =>
                      p.type === "text" && !(p as unknown as { synthetic?: boolean }).synthetic,
                  )
                  .map((p) => (p as unknown as { text: string }).text)
                  .join("\n"),
              )
              const err = createMemo(() => {
                if (msg.role !== "assistant") return undefined
                const e = (msg as AssistantMessage).error
                if (!e) return undefined
                return (e.data as { message?: string }).message ?? e.name
              })
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
                      <Show when={err()}>
                        <text fg={theme.error}>{err()}</text>
                      </Show>
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
          <Show when={busy()}>
            <text fg={theme.textMuted}>Thinking...</text>
          </Show>
          <Show when={error()}>
            <text fg={theme.error}>{error()}</text>
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
