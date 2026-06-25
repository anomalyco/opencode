import { createEffect, createMemo, For, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useRenderer } from "@opentui/solid"
import type { McpEventElicitationRequest } from "@opencode-ai/sdk/v2"
import { tint, useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../ui/border"
import { useBindings, useOpencodeModeStack } from "../../keymap"

const MCP_ELICITATION_MODE = "mcp-elicitation"

function values(request: McpEventElicitationRequest) {
  return Object.fromEntries(
    Object.entries(request.schema.properties).map(([key, prop]) => [key, prop.default ?? false]),
  )
}

export function McpElicitationPrompt(props: { request: McpEventElicitationRequest; directory?: string }) {
  const sdk = useSDK()
  const renderer = useRenderer()
  const { theme } = useTheme()
  const modeStack = useOpencodeModeStack()
  const fields = createMemo(() => Object.entries(props.request.schema.properties))
  const [store, setStore] = createStore({
    requestID: props.request.id,
    selected: 0,
    values: values(props.request),
  })

  createEffect(() => {
    if (store.requestID === props.request.id) return
    setStore({
      requestID: props.request.id,
      selected: 0,
      values: values(props.request),
    })
  })

  function move(delta: number) {
    const total = fields().length
    if (total === 0) return
    setStore("selected", (store.selected + delta + total) % total)
  }

  function toggle(index = store.selected) {
    const field = fields()[index]
    if (!field) return
    setStore("values", field[0], !store.values[field[0]])
  }

  function reply() {
    void sdk.client.mcp.elicitation.reply({
      requestID: props.request.id,
      directory: props.directory,
      content: { ...store.values },
    })
  }

  function decline() {
    void sdk.client.mcp.elicitation.decline({
      requestID: props.request.id,
      directory: props.directory,
    })
  }

  function cancel() {
    void sdk.client.mcp.elicitation.cancel({
      requestID: props.request.id,
      directory: props.directory,
    })
  }

  onMount(() => {
    const popMode = modeStack.push(MCP_ELICITATION_MODE)
    onCleanup(popMode)
  })

  useBindings(() => ({
    mode: MCP_ELICITATION_MODE,
    commands: [
      {
        name: "app.exit",
        title: "Cancel MCP request",
        category: "MCP",
        run() {
          cancel()
        },
      },
    ],
    bindings: [
      { key: "up", desc: "Previous field", group: "MCP", cmd: () => move(-1) },
      { key: "k", desc: "Previous field", group: "MCP", cmd: () => move(-1) },
      { key: "down", desc: "Next field", group: "MCP", cmd: () => move(1) },
      { key: "j", desc: "Next field", group: "MCP", cmd: () => move(1) },
      { key: "space", desc: "Toggle field", group: "MCP", cmd: () => toggle() },
      { key: "return", desc: "Accept MCP request", group: "MCP", cmd: () => reply() },
      { key: "escape", desc: "Cancel MCP request", group: "MCP", cmd: () => cancel() },
      { key: "d", desc: "Decline MCP request", group: "MCP", cmd: () => decline() },
    ],
  }))

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box paddingLeft={1}>
          <text fg={theme.text}>
            MCP request from <span style={{ fg: theme.warning }}>{props.request.server}</span>
          </text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>{props.request.message}</text>
        </box>
        <box paddingLeft={1}>
          <For each={fields()}>
            {([key, field], index) => {
              const active = () => index() === store.selected
              const checked = () => store.values[key]
              return (
                <box
                  onMouseOver={() => setStore("selected", index())}
                  onMouseDown={() => setStore("selected", index())}
                  onMouseUp={() => {
                    if (renderer.getSelection()?.getSelectedText()) return
                    toggle(index())
                  }}
                >
                  <box flexDirection="row">
                    <box backgroundColor={active() ? theme.backgroundElement : undefined} paddingRight={1}>
                      <text fg={active() ? tint(theme.textMuted, theme.secondary, 0.6) : theme.textMuted}>
                        {`${index() + 1}.`}
                      </text>
                    </box>
                    <box backgroundColor={active() ? theme.backgroundElement : undefined}>
                      <text fg={theme.text}>
                        [{checked() ? "x" : " "}] {field.title ?? key}
                      </text>
                    </box>
                  </box>
                  <box paddingLeft={3}>
                    <text fg={theme.textMuted}>{field.description ?? key}</text>
                  </box>
                </box>
              )
            }}
          </For>
        </box>
      </box>
      <box flexDirection="row" flexShrink={0} gap={2} paddingLeft={2} paddingRight={3} paddingBottom={1}>
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>accept</span>
        </text>
        <text fg={theme.text}>
          space <span style={{ fg: theme.textMuted }}>toggle</span>
        </text>
        <text fg={theme.text}>
          d <span style={{ fg: theme.textMuted }}>decline</span>
        </text>
        <text fg={theme.text}>
          esc <span style={{ fg: theme.textMuted }}>cancel</span>
        </text>
      </box>
    </box>
  )
}
