import type { PanelInput } from "@opencode/plugin/tui/context"
import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { TextAttributes, type RGBA, type TextareaRenderable } from "@opentui/core"
import { createMemo, createSignal, For, Match, onMount, Show, Switch } from "solid-js"
import { Spinner } from "../../../component/spinner"
import { useConfig } from "../../../config"
import { useData } from "../../../context/data"
import { Keymap } from "../../../context/keymap"
import { useTheme, useThemes } from "../../../context/theme"
import { usePlugin } from "../../../plugin/context"
import type { Voice } from "./voice"

const LEVELS = "▁▂▃▄▅▆▇█"

export function CompanionPanel(props: {
  input: PanelInput
  companionID?: string
  error?: string
  voice: Voice
  onSubmit: (text: string) => void
  onStop: () => void
}) {
  const theme = useTheme()
  const data = useData()
  const config = useConfig().data
  const shortcuts = Keymap.useShortcuts()
  const [target, setTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable | undefined

  const messages = createMemo(() => (props.companionID ? data.session.message.list(props.companionID) : []))
  const running = () => (props.companionID ? data.session.status(props.companionID) === "running" : false)
  const background = () => (props.input.presentation === "panel" ? theme.background.raised.base : theme.background.base)

  const submit = () => {
    const text = textarea?.plainText.trim()
    if (!text || !textarea) return
    textarea.clear()
    props.onSubmit(text)
  }

  Keymap.createLayer(() => ({
    target,
    enabled: target() !== undefined,
    // Submitting must win over the managed textarea's newline binding.
    priority: 1,
    commands: [{ id: "companion.submit", title: "Send to companion", group: "Companion", run: submit }],
  }))
  Keymap.createLayer(() => ({
    commands: [{ id: "companion.stop", title: "Stop companion voice", group: "Companion", run: props.onStop }],
  }))

  onMount(() => {
    props.input.focus()
    setTimeout(() => {
      if (textarea && !textarea.isDestroyed) textarea.focus()
    }, 1)
  })

  return (
    <box flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1} gap={1}>
      <box flexDirection="row" gap={2} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexGrow={1}>
          Companion
        </text>
        <VoiceStatus voice={props.voice} running={running()} />
      </box>
      <Show when={props.error}>
        <text fg={theme.text.feedback.error.base} wrapMode="word" flexShrink={0}>
          {props.error}
        </text>
      </Show>
      <scrollbox
        flexGrow={1}
        minHeight={0}
        stickyScroll
        stickyStart="bottom"
        scrollbarOptions={{ visible: false }}
        contentOptions={{ gap: 1 }}
      >
        <Show
          when={messages().length > 0}
          fallback={
            <text fg={theme.text.muted} wrapMode="word">
              Ask about the main session, or tell the companion what the main session should do next.
            </text>
          }
        >
          <For each={messages()}>{(message) => <Row message={message} background={background()} />}</For>
        </Show>
      </scrollbox>
      <box flexShrink={0} gap={1} paddingBottom={1}>
        <textarea
          minHeight={1}
          maxHeight={6}
          wrapMode="word"
          ref={(value: TextareaRenderable) => {
            textarea = value
            setTarget(value)
          }}
          placeholder="Talk to the companion"
          placeholderColor={theme.text.muted}
          textColor={theme.text.formfield.base}
          focusedTextColor={theme.text.formfield.base}
          cursorColor={theme.text.base}
          cursorStyle={config.cursor}
        />
        <text fg={theme.text.muted} wrapMode="word">
          {[
            [shortcuts.get("companion.submit"), "send"],
            [shortcuts.get("companion.talk"), "talk"],
            [shortcuts.get("companion.stop"), "stop"],
            [shortcuts.get("session.companion"), "close"],
          ]
            .filter((item): item is [string, string] => Boolean(item[0]))
            .map(([key, label]) => `${key} ${label}`)
            .join(" · ")}
        </text>
      </box>
    </box>
  )
}

function VoiceStatus(props: { voice: Voice; running: boolean }) {
  const theme = useTheme()
  const color = () => theme.text.feedback.info.base
  return (
    <Switch>
      <Match when={props.voice.state.status === "listening"}>
        <text fg={color()} flexShrink={0}>
          ● listening {LEVELS[Math.min(LEVELS.length - 1, Math.floor(props.voice.state.level * LEVELS.length))]}
        </text>
      </Match>
      <Match when={props.voice.state.status === "transcribing"}>
        <Spinner color={color()}>transcribing</Spinner>
      </Match>
      <Match when={props.voice.state.status === "speaking"}>
        <text fg={color()} flexShrink={0}>
          ♪ speaking
        </text>
      </Match>
      <Match when={props.running}>
        <Spinner color={theme.text.muted}>thinking</Spinner>
      </Match>
    </Switch>
  )
}

function Row(props: { message: SessionMessageInfo; background: RGBA }) {
  const theme = useTheme()
  return (
    <Switch>
      <Match when={props.message.type === "user" && props.message}>
        {(message) => (
          <box flexDirection="row" gap={1} flexShrink={0}>
            <text fg={theme.text.muted} flexShrink={0}>
              {message().metadata?.voice === true ? "◉" : "›"}
            </text>
            <text fg={theme.text.base} wrapMode="word" flexGrow={1}>
              {message().text}
            </text>
          </box>
        )}
      </Match>
      <Match when={props.message.type === "synthetic" && props.message}>
        {(message) => (
          <text fg={theme.text.muted} wrapMode="word" flexShrink={0}>
            {message().description ?? message().text}
          </text>
        )}
      </Match>
      <Match when={props.message.type === "assistant" && props.message}>
        {(message) => <Assistant message={message()} background={props.background} />}
      </Match>
    </Switch>
  )
}

function Assistant(props: { message: SessionMessageAssistant; background: RGBA }) {
  const theme = useTheme()
  const syntax = useThemes().currentSyntax
  const plugins = usePlugin()
  return (
    <box flexShrink={0} gap={1}>
      <For each={props.message.content}>
        {(part) => (
          <Switch>
            <Match when={part.type === "text" && part.text.trim() ? part.text.trim() : undefined}>
              {(text) => (
                <markdown
                  syntaxStyle={syntax()}
                  renderNode={plugins.markdown()}
                  content={text()}
                  streaming={props.message.time.completed === undefined}
                  internalBlockMode="top-level"
                  tableOptions={{ style: "grid", cellPaddingX: 1 }}
                  conceal
                  fg={theme.markdown.text}
                  bg={props.background}
                />
              )}
            </Match>
            <Match when={part.type === "tool" && part}>
              {(tool) => (
                <text
                  fg={tool().state.status === "error" ? theme.text.feedback.error.base : theme.text.muted}
                  wrapMode="word"
                >
                  {toolLabel(tool())}
                </text>
              )}
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.message.error}>
        {(error) => (
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            {error().message}
          </text>
        )}
      </Show>
    </box>
  )
}

function toolLabel(tool: SessionMessageAssistantTool) {
  const input = tool.state.status === "streaming" ? {} : tool.state.input
  const text = (key: string) => {
    const value = input[key]
    return typeof value === "string" ? value : undefined
  }
  const pending = tool.state.status === "streaming" || tool.state.status === "running" ? "…" : ""
  if (tool.name === "main_send") return `→ main (${text("delivery") ?? "steer"}): ${text("text") ?? ""}${pending}`
  if (tool.name === "main_status") return `· checked the main session${pending}`
  if (tool.name === "main_read") return `· read the main session${pending}`
  if (tool.name === "main_interrupt") return `■ interrupted the main session${pending}`
  if (tool.name === "main_cancel") return `× cancelled a queued prompt${pending}`
  return `· ${tool.name} ${text("command") ?? text("pattern") ?? text("path") ?? text("url") ?? text("query") ?? ""}${pending}`.trimEnd()
}
