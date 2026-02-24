import { createResource, createSignal, For, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "../../ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useSDK } from "@tui/context/sdk"

export function DialogRawContext(props: { sessionID: string }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sdk = useSDK()
  const dimensions = useTerminalDimensions()
  const [view, setView] = createSignal<"system" | "messages">("system")

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      dialog.clear()
    }
    if (evt.name === "tab") {
      evt.preventDefault()
      setView(view() === "system" ? "messages" : "system")
    }
  })

  const [context] = createResource(async () => {
    const result = await sdk.client.session.context({ sessionID: props.sessionID })
    return result.data
  })

  const height = () => Math.floor(dimensions().height * 0.7)

  const formatMessage = (msg: any, index: number) => {
    const role = msg.role || "unknown"
    const content = Array.isArray(msg.content)
      ? msg.content
          .map((part: any) => {
            if (typeof part === "string") return part
            if (part.type === "text") return part.text
            if (part.type === "tool-call") return `[Tool: ${part.toolName}]`
            if (part.type === "tool-result") return `[Tool Result: ${part.toolCallId}]`
            if (part.type === "file") return `[File: ${part.filename || part.mediaType}]`
            return `[${part.type}]`
          })
          .join("\n")
      : typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content, null, 2)

    return { role, content, index }
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Raw LLM Context
        </text>
        <text fg={theme.textMuted}>tab to switch | esc to close</text>
      </box>

      <Show when={context.loading}>
        <text fg={theme.textMuted}>Loading context...</text>
      </Show>

      <Show when={context.error}>
        <text fg={theme.error}>Error: {String(context.error)}</text>
      </Show>

      <Show when={context()}>
        <box flexDirection="row" gap={2} paddingTop={1}>
          <text
            fg={view() === "system" ? theme.accent : theme.textMuted}
            attributes={view() === "system" ? TextAttributes.BOLD : undefined}
          >
            System Prompts ({context()!.system.length})
          </text>
          <text
            fg={view() === "messages" ? theme.accent : theme.textMuted}
            attributes={view() === "messages" ? TextAttributes.BOLD : undefined}
          >
            Messages ({context()!.messages.length})
          </text>
        </box>

        <box paddingTop={1}>
          <text fg={theme.textMuted}>
            Model: {context()!.model.providerID}/{context()!.model.modelID} | Agent: {context()!.agent}
          </text>
        </box>

        <Show when={view() === "system"}>
          <scrollbox maxHeight={height()} scrollbarOptions={{ visible: true }} paddingRight={1}>
            <For each={context()!.system}>
              {(prompt, i) => (
                <box paddingTop={1} paddingBottom={1}>
                  <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                    System Prompt {i() + 1}
                  </text>
                  <box
                    paddingTop={1}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.backgroundElement}
                    marginTop={1}
                  >
                    <text fg={theme.text} wrapMode="word">
                      {prompt}
                    </text>
                  </box>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>

        <Show when={view() === "messages"}>
          <scrollbox maxHeight={height()} scrollbarOptions={{ visible: true }} paddingRight={1}>
            <For each={context()!.messages.map(formatMessage)}>
              {(msg) => (
                <box paddingTop={1} paddingBottom={1}>
                  <text
                    fg={msg.role === "user" ? theme.accent : msg.role === "assistant" ? theme.primary : theme.textMuted}
                    attributes={TextAttributes.BOLD}
                  >
                    [{msg.index + 1}] {msg.role.toUpperCase()}
                  </text>
                  <box
                    paddingTop={1}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.backgroundElement}
                    marginTop={1}
                  >
                    <text fg={theme.text} wrapMode="word">
                      {msg.content}
                    </text>
                  </box>
                </box>
              )}
            </For>
          </scrollbox>
        </Show>
      </Show>
    </box>
  )
}
