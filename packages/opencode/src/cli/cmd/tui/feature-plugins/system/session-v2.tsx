import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { useSyncV2 } from "@tui/context/sync-v2"
import { SplitBorder } from "@tui/component/border"
import { Spinner } from "@tui/component/spinner"
import { useTheme } from "@tui/context/theme"
import { useLocal } from "@tui/context/local"
import { useKeyboard, useRenderer, useTerminalDimensions, type JSX } from "@opentui/solid"
import { TextAttributes, type BoxRenderable, type SyntaxStyle } from "@opentui/core"
import { Locale } from "@/util/locale"
import { LANGUAGE_EXTENSIONS } from "@/lsp/language"
import path from "path"
import stripAnsi from "strip-ansi"
import type {
  SessionMessage,
  SessionMessageAgentSwitched,
  SessionMessageAssistant,
  SessionMessageAssistantReasoning,
  SessionMessageAssistantText,
  SessionMessageAssistantTool,
  SessionMessageCompaction,
  SessionMessageModelSwitched,
  SessionMessageShell,
  SessionMessageSynthetic,
  SessionMessageUser,
  ToolFileContent,
  ToolTextContent,
} from "@opencode-ai/sdk/v2"
import { createEffect, createMemo, createSignal, For, Match, Show, Switch } from "solid-js"

const id = "internal:session-v2-debug"
const route = "session.v2.messages"

function currentSessionID(api: TuiPluginApi) {
  const current = api.route.current
  if (current.name !== "session") return
  const sessionID = current.params?.sessionID
  return typeof sessionID === "string" ? sessionID : undefined
}

function View(props: { api: TuiPluginApi; sessionID: string }) {
  const sync = useSyncV2()
  const dimensions = useTerminalDimensions()
  const { theme, syntax, subtleSyntax } = useTheme()
  const messages = createMemo(() => sync.data.messages[props.sessionID] ?? [])
  const renderedMessages = createMemo(() => messages().toReversed())
  const lastAssistant = createMemo(() => renderedMessages().findLast((message) => message.type === "assistant"))
  const lastUserCreated = (index: number) =>
    renderedMessages()
      .slice(0, index)
      .findLast((message) => message.type === "user")?.time.created

  createEffect(() => {
    void sync.session.message.sync(props.sessionID)
  })

  useKeyboard((event) => {
    if (event.name !== "escape") return
    event.preventDefault()
    event.stopPropagation()
    props.api.route.navigate("session", { sessionID: props.sessionID })
  })

  return (
    <box width={dimensions().width} height={dimensions().height} backgroundColor={theme.background}>
      <box flexDirection="row">
        <box flexGrow={1} paddingBottom={1} paddingLeft={2} paddingRight={2} gap={1}>
          <scrollbox
            viewportOptions={{ paddingRight: 0 }}
            verticalScrollbarOptions={{ visible: false }}
            stickyScroll={true}
            stickyStart="bottom"
            flexGrow={1}
          >
            <box height={1} />
            <Show when={messages().length === 0}>
              <MissingData label="Messages" detail="No v2 messages loaded from useSyncV2 yet." />
            </Show>
            <For each={renderedMessages()}>
              {(message, index) => (
                <Switch>
                  <Match when={message.type === "user"}>
                    <UserMessage message={message as SessionMessageUser} index={index()} />
                  </Match>
                  <Match when={message.type === "assistant"}>
                    <AssistantMessage
                      message={message as SessionMessageAssistant}
                      last={lastAssistant()?.id === message.id}
                      syntax={syntax()}
                      subtleSyntax={subtleSyntax()}
                      start={lastUserCreated(index())}
                    />
                  </Match>
                  <Match when={message.type === "synthetic"}>
                    <></>
                  </Match>
                  <Match when={message.type === "shell"}>
                    <ShellMessage message={message as SessionMessageShell} />
                  </Match>
                  <Match when={message.type === "compaction"}>
                    <CompactionMessage message={message as SessionMessageCompaction} />
                  </Match>
                  <Match when={message.type === "agent-switched"}>
                    <AgentSwitchedMessage message={message as SessionMessageAgentSwitched} />
                  </Match>
                  <Match when={message.type === "model-switched"}>
                    <ModelSwitchedMessage message={message as SessionMessageModelSwitched} />
                  </Match>
                  <Match when={true}>
                    <UnknownMessage message={message} />
                  </Match>
                </Switch>
              )}
            </For>
          </scrollbox>
          <MissingData
            label="Session prompt, permission prompt, question prompt, sidebar"
            detail="The v2 message endpoint only exposes messages, so these session UI regions cannot be rendered here. Press Esc to return to the live session."
          />
        </box>
      </box>
    </box>
  )
}

function MissingData(props: { label: string; detail: string }) {
  const { theme } = useTheme()
  return (
    <box
      border={["left"]}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.warning}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingTop={1}
      paddingBottom={1}
      marginTop={1}
      flexShrink={0}
    >
      <text fg={theme.text}>
        <span style={{ bg: theme.warning, fg: theme.background, bold: true }}> MISSING DATA </span> {props.label}
      </text>
      <text fg={theme.textMuted}>{props.detail}</text>
    </box>
  )
}

function UserMessage(props: { message: SessionMessageUser; index: number }) {
  const { theme } = useTheme()
  const attachments = createMemo(() => [...(props.message.files ?? []), ...(props.message.agents ?? [])])
  return (
    <box
      id={props.message.id}
      border={["left"]}
      borderColor={theme.secondary}
      customBorderChars={SplitBorder.customBorderChars}
      marginTop={props.index === 0 ? 0 : 1}
      flexShrink={0}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      backgroundColor={theme.backgroundPanel}
    >
      <text fg={theme.text}>{props.message.text}</text>
      <Show when={attachments().length}>
        <box flexDirection="row" paddingTop={1} gap={1} flexWrap="wrap">
          <For each={props.message.files ?? []}>
            {(file) => (
              <text fg={theme.text}>
                <span style={{ bg: theme.secondary, fg: theme.background }}> {file.mime} </span>
                <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {file.name ?? file.uri} </span>
              </text>
            )}
          </For>
          <For each={props.message.agents ?? []}>
            {(agent) => (
              <text fg={theme.text}>
                <span style={{ bg: theme.accent, fg: theme.background }}> agent </span>
                <span style={{ bg: theme.backgroundElement, fg: theme.textMuted }}> {agent.name} </span>
              </text>
            )}
          </For>
        </box>
      </Show>
    </box>
  )
}

function ShellMessage(props: { message: SessionMessageShell }) {
  const { theme } = useTheme()
  const output = createMemo(() => stripAnsi(props.message.output.trim()))
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })
  return (
    <BlockTool
      title="# Shell"
      spinner={!props.message.time.completed}
      onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
    >
      <box gap={1}>
        <text fg={theme.text}>$ {props.message.command}</text>
        <Show when={output()}>
          <text fg={theme.text}>{limited()}</text>
        </Show>
        <Show when={overflow()}>
          <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
        </Show>
      </box>
    </BlockTool>
  )
}

function CompactionMessage(props: { message: SessionMessageCompaction }) {
  const { theme, syntax } = useTheme()
  return (
    <box
      marginTop={1}
      border={["top"]}
      title={props.message.reason === "auto" ? " Auto Compaction " : " Compaction "}
      titleAlignment="center"
      borderColor={theme.borderActive}
      flexShrink={0}
    >
      <Show when={props.message.summary}>
        {(summary) => (
          <box paddingLeft={3} paddingTop={1}>
            <code
              filetype="markdown"
              drawUnstyledText={false}
              streaming={false}
              syntaxStyle={syntax()}
              content={summary().trim()}
              conceal={true}
              fg={theme.text}
            />
          </box>
        )}
      </Show>
    </box>
  )
}

function AgentSwitchedMessage(props: { message: SessionMessageAgentSwitched }) {
  const { theme } = useTheme()
  const local = useLocal()
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0}>
      <text>
        <span style={{ fg: local.agent.color(props.message.agent) }}>▣ </span>
        <span style={{ fg: theme.textMuted }}>Switched agent to </span>
        <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.agent)}</span>
      </text>
    </box>
  )
}

function ModelSwitchedMessage(props: { message: SessionMessageModelSwitched }) {
  const { theme } = useTheme()
  const model = createMemo(() => {
    const variant = props.message.model.variant ? `/${props.message.model.variant}` : ""
    return `${props.message.model.providerID}/${props.message.model.id}${variant}`
  })
  return (
    <box paddingLeft={3} marginTop={1} flexShrink={0}>
      <text>
        <span style={{ fg: theme.secondary }}>◇ </span>
        <span style={{ fg: theme.textMuted }}>Switched model to </span>
        <span style={{ fg: theme.text }}>{model()}</span>
      </text>
    </box>
  )
}

function UnknownMessage(props: { message: SessionMessage }) {
  return <MissingData label="Unknown message type" detail={JSON.stringify(props.message)} />
}

function AssistantMessage(props: {
  message: SessionMessageAssistant
  last: boolean
  syntax: SyntaxStyle
  subtleSyntax: SyntaxStyle
  start?: number
}) {
  const { theme } = useTheme()
  const local = useLocal()
  const duration = createMemo(() => {
    if (!props.message.time.completed) return 0
    return props.message.time.completed - (props.start ?? props.message.time.created)
  })
  const model = createMemo(() => {
    const variant = props.message.model.variant ? `/${props.message.model.variant}` : ""
    return `${props.message.model.providerID}/${props.message.model.id}${variant}`
  })
  const final = createMemo(() => props.message.finish && !["tool-calls", "unknown"].includes(props.message.finish))
  return (
    <>
      <For each={props.message.content}>
        {(part) => (
          <Switch>
            <Match when={part.type === "text"}>
              <AssistantText part={part as SessionMessageAssistantText} syntax={props.syntax} />
            </Match>
            <Match when={part.type === "reasoning"}>
              <AssistantReasoning part={part as SessionMessageAssistantReasoning} subtleSyntax={props.subtleSyntax} />
            </Match>
            <Match when={part.type === "tool"}>
              <AssistantTool part={part as SessionMessageAssistantTool} />
            </Match>
          </Switch>
        )}
      </For>
      <Show when={props.message.content.length === 0}>
        <MissingData label="Assistant content" detail={`Assistant message ${props.message.id} has no content items.`} />
      </Show>
      <Show when={props.message.error}>
        <box
          border={["left"]}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          marginTop={1}
          backgroundColor={theme.backgroundPanel}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.error}
          flexShrink={0}
        >
          <text fg={theme.textMuted}>{props.message.error}</text>
        </box>
      </Show>
      <Show when={props.last || final() || props.message.error}>
        <box paddingLeft={3} flexShrink={0}>
          <text marginTop={1}>
            <span style={{ fg: local.agent.color(props.message.agent) }}>▣ </span>
            <span style={{ fg: theme.text }}>{Locale.titlecase(props.message.agent)}</span>
            <span style={{ fg: theme.textMuted }}> · {model()}</span>
            <Show when={duration()}>
              <span style={{ fg: theme.textMuted }}> · {Locale.duration(duration())}</span>
            </Show>
          </text>
        </box>
      </Show>
    </>
  )
}

function AssistantText(props: { part: SessionMessageAssistantText; syntax: SyntaxStyle }) {
  const { theme } = useTheme()
  return (
    <Show when={props.part.text.trim()}>
      <box paddingLeft={3} marginTop={1} flexShrink={0} id="text">
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={props.syntax}
          content={props.part.text.trim()}
          conceal={true}
          fg={theme.text}
        />
      </box>
    </Show>
  )
}

function AssistantReasoning(props: { part: SessionMessageAssistantReasoning; subtleSyntax: SyntaxStyle }) {
  const { theme } = useTheme()
  const content = createMemo(() => props.part.text.replace("[REDACTED]", "").trim())
  return (
    <Show when={content()}>
      <box
        paddingLeft={2}
        marginTop={1}
        flexDirection="column"
        border={["left"]}
        customBorderChars={SplitBorder.customBorderChars}
        borderColor={theme.backgroundElement}
        flexShrink={0}
      >
        <code
          filetype="markdown"
          drawUnstyledText={false}
          streaming={true}
          syntaxStyle={props.subtleSyntax}
          content={"_Thinking:_ " + content()}
          conceal={true}
          fg={theme.textMuted}
        />
      </box>
    </Show>
  )
}

function AssistantTool(props: { part: SessionMessageAssistantTool }) {
  const input = createMemo(() => toolInputRecord(props.part.state.input))
  const toolprops = {
    get input() {
      return input()
    },
    get metadata() {
      return props.part.provider?.metadata ?? {}
    },
    get output() {
      return props.part.state.status === "pending" ? undefined : toolOutput(props.part.state.content)
    },
    part: props.part,
  }
  return (
    <Switch>
      <Match when={props.part.name === "bash"}>
        <Bash {...toolprops} />
      </Match>
      <Match when={props.part.name === "glob"}>
        <Glob {...toolprops} />
      </Match>
      <Match when={props.part.name === "read"}>
        <Read {...toolprops} />
      </Match>
      <Match when={props.part.name === "grep"}>
        <Grep {...toolprops} />
      </Match>
      <Match when={props.part.name === "webfetch"}>
        <WebFetch {...toolprops} />
      </Match>
      <Match when={props.part.name === "codesearch"}>
        <CodeSearch {...toolprops} />
      </Match>
      <Match when={props.part.name === "websearch"}>
        <WebSearch {...toolprops} />
      </Match>
      <Match when={props.part.name === "write"}>
        <Write {...toolprops} />
      </Match>
      <Match when={props.part.name === "edit"}>
        <Edit {...toolprops} />
      </Match>
      <Match when={props.part.name === "apply_patch"}>
        <ApplyPatch {...toolprops} />
      </Match>
      <Match when={props.part.name === "todowrite"}>
        <TodoWrite {...toolprops} />
      </Match>
      <Match when={props.part.name === "question"}>
        <Question {...toolprops} />
      </Match>
      <Match when={props.part.name === "skill"}>
        <Skill {...toolprops} />
      </Match>
      <Match when={props.part.name === "task"}>
        <Task {...toolprops} />
      </Match>
      <Match when={true}>
        <GenericTool {...toolprops} />
      </Match>
    </Switch>
  )
}

type ToolProps = {
  input: Record<string, unknown>
  metadata: Record<string, unknown>
  output?: string
  part: SessionMessageAssistantTool
}

function GenericTool(props: ToolProps) {
  const { theme } = useTheme()
  const output = createMemo(() => props.output?.trim() ?? "")
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const maxLines = 3
  const overflow = createMemo(() => lines().length > maxLines)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, maxLines), "…"].join("\n")
  })
  return (
    <Show
      when={output()}
      fallback={
        <InlineTool icon="⚙" pending="Writing command..." complete={toolComplete(props.part)} part={props.part}>
          {props.part.name} {input(props.input)}
        </InlineTool>
      }
    >
      <BlockTool
        title={`# ${props.part.name} ${input(props.input)}`}
        part={props.part}
        onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
      >
        <box gap={1}>
          <text fg={theme.text}>{limited()}</text>
          <Show when={overflow()}>
            <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
          </Show>
        </box>
      </BlockTool>
    </Show>
  )
}

function InlineTool(props: {
  icon: string
  complete: unknown
  pending: string
  spinner?: boolean
  children: JSX.Element
  part: SessionMessageAssistantTool
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [margin, setMargin] = createSignal(0)
  const [hover, setHover] = createSignal(false)
  const [showError, setShowError] = createSignal(false)
  const error = createMemo(() => (props.part.state.status === "error" ? props.part.state.error.message : undefined))
  const complete = createMemo(() => !!props.complete)
  const denied = createMemo(() => {
    const message = error()
    if (!message) return false
    return (
      message.includes("QuestionRejectedError") ||
      message.includes("rejected permission") ||
      message.includes("specified a rule") ||
      message.includes("user dismissed")
    )
  })
  const fg = createMemo(() => {
    if (error()) return theme.error
    if (complete()) return theme.textMuted
    return theme.text
  })
  const attributes = createMemo(() => (denied() ? TextAttributes.STRIKETHROUGH : undefined))
  return (
    <box
      marginTop={margin()}
      paddingLeft={3}
      flexShrink={0}
      flexDirection="row"
      gap={1}
      backgroundColor={hover() && error() ? theme.backgroundMenu : undefined}
      onMouseOver={() => error() && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (!error()) return
        if (renderer.getSelection()?.getSelectedText()) return
        setShowError((prev) => !prev)
      }}
      renderBefore={function () {
        const el = this as BoxRenderable
        const parent = el.parent
        if (!parent) return
        const previous = parent.getChildren()[parent.getChildren().indexOf(el) - 1]
        if (!previous) {
          setMargin(0)
          return
        }
        if (previous.id.startsWith("text")) setMargin(1)
      }}
    >
      <box flexShrink={0}>
        <Switch>
          <Match when={props.spinner}>
            <Spinner color={theme.text} />
          </Match>
          <Match when={complete()}>
            <text fg={fg()} attributes={attributes()}>
              {props.icon}
            </text>
          </Match>
          <Match when={true}>
            <text fg={fg()} attributes={attributes()}>
              ~
            </text>
          </Match>
        </Switch>
      </box>
      <box flexGrow={1}>
        <box>
          <Switch>
            <Match when={complete()}>
              <text fg={fg()} attributes={attributes()}>
                {props.children}
              </text>
            </Match>
            <Match when={true}>
              <text fg={fg()} attributes={attributes()}>
                {props.pending}
              </text>
            </Match>
          </Switch>
        </box>
        <Show when={showError() && error()}>
          <box>
            <text fg={theme.error}>{error()}</text>
          </box>
        </Show>
      </box>
    </box>
  )
}

function BlockTool(props: {
  title: string
  children: JSX.Element
  part?: SessionMessageAssistantTool
  onClick?: () => void
  spinner?: boolean
}) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const [hover, setHover] = createSignal(false)
  const error = createMemo(() => (props.part?.state.status === "error" ? props.part.state.error.message : undefined))
  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      marginTop={1}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        if (renderer.getSelection()?.getSelectedText()) return
        props.onClick?.()
      }}
      flexShrink={0}
    >
      <Show
        when={props.spinner}
        fallback={
          <text paddingLeft={3} fg={theme.textMuted}>
            {props.title}
          </text>
        }
      >
        <Spinner color={theme.textMuted}>{props.title.replace(/^# /, "")}</Spinner>
      </Show>
      {props.children}
      <Show when={error()}>
        <text fg={theme.error}>{error()}</text>
      </Show>
    </box>
  )
}

function Bash(props: ToolProps) {
  const { theme } = useTheme()
  const output = createMemo(() => stripAnsi((stringValue(props.metadata.output) ?? props.output ?? "").trim()))
  const command = createMemo(() => stringValue(props.input.command) ?? pendingInput(props.part))
  const title = createMemo(() => `# ${stringValue(props.input.description) ?? "Shell"}`)
  const [expanded, setExpanded] = createSignal(false)
  const lines = createMemo(() => output().split("\n"))
  const overflow = createMemo(() => lines().length > 10)
  const limited = createMemo(() => {
    if (expanded() || !overflow()) return output()
    return [...lines().slice(0, 10), "…"].join("\n")
  })
  return (
    <Switch>
      <Match when={output()}>
        <BlockTool
          title={title()}
          part={props.part}
          spinner={props.part.state.status === "running"}
          onClick={overflow() ? () => setExpanded((prev) => !prev) : undefined}
        >
          <box gap={1}>
            <text fg={theme.text}>$ {command()}</text>
            <text fg={theme.text}>{limited()}</text>
            <Show when={overflow()}>
              <text fg={theme.textMuted}>{expanded() ? "Click to collapse" : "Click to expand"}</text>
            </Show>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="$" pending="Writing command..." complete={command()} part={props.part}>
          {command()}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Glob(props: ToolProps) {
  return (
    <InlineTool icon="✱" pending="Finding files..." complete={toolComplete(props.part)} part={props.part}>
      Glob "{stringValue(props.input.pattern) ?? pendingInput(props.part)}"{" "}
      <Show when={stringValue(props.input.path)}>in {normalizePath(stringValue(props.input.path))} </Show>
      <Show when={numberValue(props.metadata.count)}>
        {(count) => (
          <>
            ({count()} {count() === 1 ? "match" : "matches"})
          </>
        )}
      </Show>
    </InlineTool>
  )
}

function Read(props: ToolProps) {
  const { theme } = useTheme()
  const loaded = createMemo(() =>
    arrayValue(props.metadata.loaded).filter((item): item is string => typeof item === "string"),
  )
  return (
    <>
      <InlineTool
        icon="→"
        pending="Reading file..."
        complete={stringValue(props.input.filePath) ?? pendingInput(props.part)}
        spinner={props.part.state.status === "running"}
        part={props.part}
      >
        Read {normalizePath(stringValue(props.input.filePath) ?? pendingInput(props.part))}{" "}
        {input(props.input, ["filePath"])}
      </InlineTool>
      <For each={loaded()}>
        {(filepath) => (
          <box paddingLeft={3} flexShrink={0}>
            <text paddingLeft={3} fg={theme.textMuted}>
              ↳ Loaded {normalizePath(filepath)}
            </text>
          </box>
        )}
      </For>
    </>
  )
}

function Grep(props: ToolProps) {
  return (
    <InlineTool icon="✱" pending="Searching content..." complete={toolComplete(props.part)} part={props.part}>
      Grep "{stringValue(props.input.pattern) ?? pendingInput(props.part)}"{" "}
      <Show when={stringValue(props.input.path)}>in {normalizePath(stringValue(props.input.path))} </Show>
      <Show when={numberValue(props.metadata.matches)}>
        {(matches) => (
          <>
            ({matches()} {matches() === 1 ? "match" : "matches"})
          </>
        )}
      </Show>
    </InlineTool>
  )
}

function WebFetch(props: ToolProps) {
  return (
    <InlineTool icon="%" pending="Fetching from the web..." complete={toolComplete(props.part)} part={props.part}>
      WebFetch {stringValue(props.input.url) ?? pendingInput(props.part)}
    </InlineTool>
  )
}

function CodeSearch(props: ToolProps) {
  return (
    <InlineTool icon="◇" pending="Searching code..." complete={toolComplete(props.part)} part={props.part}>
      Exa Code Search "{stringValue(props.input.query) ?? pendingInput(props.part)}"{" "}
      <Show when={numberValue(props.metadata.results)}>{(results) => <>({results()} results)</>}</Show>
    </InlineTool>
  )
}

function WebSearch(props: ToolProps) {
  return (
    <InlineTool icon="◈" pending="Searching web..." complete={toolComplete(props.part)} part={props.part}>
      Exa Web Search "{stringValue(props.input.query) ?? pendingInput(props.part)}"{" "}
      <Show when={numberValue(props.metadata.numResults)}>{(results) => <>({results()} results)</>}</Show>
    </InlineTool>
  )
}

function Write(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const filePath = createMemo(() => stringValue(props.input.filePath) ?? "")
  const content = createMemo(() => stringValue(props.input.content) ?? "")
  return (
    <Switch>
      <Match when={content() && props.part.state.status === "completed"}>
        <BlockTool title={"# Wrote " + normalizePath(filePath())} part={props.part}>
          <line_number fg={theme.textMuted} minWidth={3} paddingRight={1}>
            <code
              conceal={false}
              fg={theme.text}
              filetype={filetype(filePath())}
              syntaxStyle={syntax()}
              content={content()}
            />
          </line_number>
          <Diagnostics diagnostics={props.metadata.diagnostics} filePath={filePath()} />
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing write..." complete={filePath()} part={props.part}>
          Write {normalizePath(filePath())}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Edit(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()
  const filePath = createMemo(() => stringValue(props.input.filePath) ?? "")
  const diff = createMemo(() => stringValue(props.metadata.diff))
  return (
    <Switch>
      <Match when={diff()}>
        {(diff) => (
          <BlockTool title={"← Edit " + normalizePath(filePath())} part={props.part}>
            <box paddingLeft={1}>
              <diff
                diff={diff()}
                view={dimensions().width > 120 ? "split" : "unified"}
                filetype={filetype(filePath())}
                syntaxStyle={syntax()}
                showLineNumbers={true}
                width="100%"
                wrapMode="word"
                fg={theme.text}
                addedBg={theme.diffAddedBg}
                removedBg={theme.diffRemovedBg}
                contextBg={theme.diffContextBg}
                addedSignColor={theme.diffHighlightAdded}
                removedSignColor={theme.diffHighlightRemoved}
                lineNumberFg={theme.diffLineNumber}
                lineNumberBg={theme.diffContextBg}
                addedLineNumberBg={theme.diffAddedLineNumberBg}
                removedLineNumberBg={theme.diffRemovedLineNumberBg}
              />
            </box>
            <Diagnostics diagnostics={props.metadata.diagnostics} filePath={filePath()} />
          </BlockTool>
        )}
      </Match>
      <Match when={true}>
        <InlineTool icon="←" pending="Preparing edit..." complete={filePath()} part={props.part}>
          Edit {normalizePath(filePath())} {input({ replaceAll: props.input.replaceAll })}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function ApplyPatch(props: ToolProps) {
  const { theme, syntax } = useTheme()
  const dimensions = useTerminalDimensions()
  const files = createMemo(() => arrayValue(props.metadata.files).flatMap((item) => (isRecord(item) ? [item] : [])))
  const fileTitle = (file: Record<string, unknown>) => {
    const type = stringValue(file.type)
    const relativePath = stringValue(file.relativePath) ?? stringValue(file.filePath) ?? "patch"
    if (type === "delete") return "# Deleted " + relativePath
    if (type === "add") return "# Created " + relativePath
    if (type === "move") return "# Moved " + normalizePath(stringValue(file.filePath)) + " → " + relativePath
    return "← Patched " + relativePath
  }
  return (
    <Switch>
      <Match when={files().length > 0}>
        <For each={files()}>
          {(file) => (
            <BlockTool title={fileTitle(file)} part={props.part}>
              <Show
                when={stringValue(file.patch)}
                fallback={
                  <text fg={theme.diffRemoved}>
                    -{numberValue(file.deletions) ?? 0} line{numberValue(file.deletions) === 1 ? "" : "s"}
                  </text>
                }
              >
                {(patch) => (
                  <box paddingLeft={1}>
                    <diff
                      diff={patch()}
                      view={dimensions().width > 120 ? "split" : "unified"}
                      filetype={filetype(stringValue(file.filePath) ?? stringValue(file.relativePath))}
                      syntaxStyle={syntax()}
                      showLineNumbers={true}
                      width="100%"
                      wrapMode="word"
                      fg={theme.text}
                      addedBg={theme.diffAddedBg}
                      removedBg={theme.diffRemovedBg}
                      contextBg={theme.diffContextBg}
                      addedSignColor={theme.diffHighlightAdded}
                      removedSignColor={theme.diffHighlightRemoved}
                      lineNumberFg={theme.diffLineNumber}
                      lineNumberBg={theme.diffContextBg}
                      addedLineNumberBg={theme.diffAddedLineNumberBg}
                      removedLineNumberBg={theme.diffRemovedLineNumberBg}
                    />
                  </box>
                )}
              </Show>
            </BlockTool>
          )}
        </For>
      </Match>
      <Match when={true}>
        <InlineTool icon="%" pending="Preparing patch..." complete={false} part={props.part}>
          Patch
        </InlineTool>
      </Match>
    </Switch>
  )
}

function TodoWrite(props: ToolProps) {
  const { theme } = useTheme()
  const todos = createMemo(() => arrayValue(props.input.todos).flatMap((item) => (isRecord(item) ? [item] : [])))
  return (
    <Switch>
      <Match when={todos().length > 0 && props.part.state.status === "completed"}>
        <BlockTool title="# Todos" part={props.part}>
          <box>
            <For each={todos()}>
              {(todo) => (
                <text fg={theme.text}>
                  {todoIcon(stringValue(todo.status))} {stringValue(todo.content)}
                </text>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="⚙" pending="Updating todos..." complete={false} part={props.part}>
          Updating todos...
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Question(props: ToolProps) {
  const { theme } = useTheme()
  const questions = createMemo(() =>
    arrayValue(props.input.questions).flatMap((item) => (isRecord(item) ? [item] : [])),
  )
  const answers = createMemo(() => arrayValue(props.metadata.answers))
  return (
    <Switch>
      <Match when={answers().length > 0}>
        <BlockTool title="# Questions" part={props.part}>
          <box gap={1}>
            <For each={questions()}>
              {(question, index) => (
                <box>
                  <text fg={theme.textMuted}>{stringValue(question.question)}</text>
                  <text fg={theme.text}>{formatAnswer(answers()[index()])}</text>
                </box>
              )}
            </For>
          </box>
        </BlockTool>
      </Match>
      <Match when={true}>
        <InlineTool icon="→" pending="Asking questions..." complete={questions().length} part={props.part}>
          Asked {questions().length} question{questions().length === 1 ? "" : "s"}
        </InlineTool>
      </Match>
    </Switch>
  )
}

function Skill(props: ToolProps) {
  return (
    <InlineTool icon="→" pending="Loading skill..." complete={toolComplete(props.part)} part={props.part}>
      Skill "{stringValue(props.input.name) ?? pendingInput(props.part)}"
    </InlineTool>
  )
}

function Task(props: ToolProps) {
  const content = createMemo(() => {
    const description = stringValue(props.input.description)
    if (!description) return pendingInput(props.part)
    return `${Locale.titlecase(stringValue(props.input.subagent_type) ?? "General")} Task — ${description}`
  })
  return (
    <InlineTool
      icon="│"
      spinner={props.part.state.status === "running"}
      complete={toolComplete(props.part)}
      pending="Delegating..."
      part={props.part}
    >
      {content()}
    </InlineTool>
  )
}

function Diagnostics(props: { diagnostics: unknown; filePath: string }) {
  const { theme } = useTheme()
  const errors = createMemo(() => {
    if (!isRecord(props.diagnostics)) return []
    const value = props.diagnostics[normalizePath(props.filePath)] ?? props.diagnostics[props.filePath]
    return arrayValue(value)
      .flatMap((item) => (isRecord(item) ? [item] : []))
      .filter((diagnostic) => diagnostic.severity === 1)
      .slice(0, 3)
  })
  return (
    <Show when={errors().length}>
      <box>
        <For each={errors()}>
          {(diagnostic) => <text fg={theme.error}>Error {stringValue(diagnostic.message)}</text>}
        </For>
      </box>
    </Show>
  )
}

function toolOutput(content?: Array<ToolTextContent | ToolFileContent>) {
  return (content ?? [])
    .map((item) => {
      if (item.type === "text") return item.text.trim()
      return `[file ${item.name ?? item.uri}]`
    })
    .filter(Boolean)
    .join("\n")
}

function toolInputRecord(input: string | Record<string, unknown>) {
  if (typeof input === "string") return {}
  return input
}

function pendingInput(part: SessionMessageAssistantTool) {
  if (part.state.status !== "pending") return ""
  return part.state.input.trim()
}

function toolComplete(part: SessionMessageAssistantTool) {
  if (part.state.status === "pending") return pendingInput(part)
  return part.state.status === "completed" || part.state.status === "error" || part.state.status === "running"
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function input(input: Record<string, unknown>, omit?: string[]) {
  const primitives = Object.entries(input).filter(([key, value]) => {
    if (omit?.includes(key)) return false
    return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  })
  if (primitives.length === 0) return ""
  return `[${primitives.map(([key, value]) => `${key}=${value}`).join(", ")}]`
}

function normalizePath(input?: string) {
  if (!input) return ""
  const absolute = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input)
  const relative = path.relative(process.cwd(), absolute)
  if (!relative) return "."
  if (!relative.startsWith("..")) return relative
  return absolute
}

function filetype(input?: string) {
  if (!input) return "none"
  const language = LANGUAGE_EXTENSIONS[path.extname(input)]
  if (["typescriptreact", "javascriptreact", "javascript"].includes(language)) return "typescript"
  return language
}

function todoIcon(status?: string) {
  if (status === "completed") return "✓"
  if (status === "in_progress") return "~"
  if (status === "cancelled") return "✕"
  return "☐"
}

function formatAnswer(answer: unknown) {
  if (!Array.isArray(answer)) return "(no answer)"
  if (answer.length === 0) return "(no answer)"
  return answer.filter((item): item is string => typeof item === "string").join(", ")
}

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: route,
      render(input) {
        const sessionID = input.params?.sessionID
        if (typeof sessionID !== "string") {
          return <text fg={api.theme.current.error}>Missing sessionID</text>
        }
        return <View api={api} sessionID={sessionID} />
      },
    },
  ])

  api.command.register(() => [
    {
      title: "View v2 session messages",
      value: route,
      category: "Debug",
      suggested: api.route.current.name === "session",
      enabled: api.route.current.name === "session",
      onSelect() {
        const sessionID = currentSessionID(api)
        if (!sessionID) return
        api.route.navigate(route, { sessionID })
        api.ui.dialog.clear()
      },
    },
  ])
}

const plugin: TuiPluginModule & { id: string } = {
  id,
  tui,
}

export default plugin
