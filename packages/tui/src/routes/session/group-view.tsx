import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import { RGBA } from "@opentui/core"
import { useRenderer, type JSX } from "@opentui/solid"
import type { SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { createSyntaxStyleMemo, useTheme, useThemes } from "../../context/theme"
import { reasoningSummary } from "../../context/thinking"
import { SplitBorder } from "../../ui/border"
import { Locale } from "../../util/locale"
import { EntryAnchor, GroupAnchor, visitEntries } from "./anchor-view"
import { groupID } from "./anchors"
import type { PartRef, SessionEntry, SessionGroup, SessionNode } from "./grouping/session"
import { InlineToolRow, reasoningContent, toolDisplay } from "./message-parts"
import { use } from "./render-context"
import { resolvePart } from "./rows"
import { generateThinkingSyntax } from "./thinking-syntax"

type Renderers = {
  message: (messageID: string) => SessionMessageInfo | undefined
  entry: (entry: SessionEntry, images?: boolean) => JSX.Element
  images: (parts: readonly SessionMessageAssistantTool[]) => JSX.Element
}

type GroupProps = Renderers & {
  node: Extract<SessionNode, { type: "group" }>
  level: number
  completed: boolean
  pending: readonly PartRef[]
  pendingOutside?: boolean
  imagesOutside?: boolean
}

export function SessionGroupView(props: Renderers & { row: SessionGroup }) {
  return (
    <Group
      {...props}
      node={props.row}
      level={0}
      completed={props.row.completed}
      pending={props.row.kind === "exploration" ? props.row.pending : []}
    />
  )
}

function Group(props: GroupProps) {
  // Keep kind-specific hover/title state isolated during reconciliation.
  return (
    <Show when={props.node.kind} keyed>
      {(_kind) => <GroupContent {...props} />}
    </Show>
  )
}

function GroupContent(props: GroupProps) {
  const ctx = use()
  const theme = useTheme()
  const renderer = useRenderer()
  const id = createMemo(() => groupID(props.node, props.level))
  const expanded = () => {
    const key = id()
    return key ? (ctx.groupExpanded(key) ?? false) : false
  }
  const [hover, setHover] = createSignal(false)
  const entries = createMemo(() => {
    const result: SessionEntry[] = []
    visitEntries(props.node.children, (entry) => result.push(entry))
    return result
  })
  const refs = createMemo(() =>
    entries().flatMap((entry) => (entry.type === "part" && !isPending(entry, props.pending) ? [entry.ref] : [])),
  )
  const thoughts = createMemo(() =>
    props.node.kind !== "reasoning"
      ? []
      : refs().flatMap((ref) => {
          const message = props.message(ref.messageID)
          if (message?.type !== "assistant") return []
          const part = resolvePart(message, ref.partID)
          if (part?.type !== "reasoning" || !reasoningContent(part)) return []
          return [{ message, part }]
        }),
  )
  const tools = createMemo(() =>
    props.node.kind !== "exploration"
      ? []
      : refs().flatMap((ref) => {
          const message = props.message(ref.messageID)
          if (message?.type !== "assistant") return []
          const part = resolvePart(message, ref.partID)
          return part?.type === "tool" ? [part] : []
        }),
  )
  const latest = createMemo((previous: string | null) => {
    const item = thoughts().at(-1)
    if (!item) return previous
    const title = reasoningSummary(reasoningContent(item.part)).title
    if (title) return title
    if (item.part.time?.completed !== undefined || item.message.time.completed !== undefined) return null
    return previous
  }, null)
  const duration = createMemo(() =>
    thoughts().reduce((total, item) => {
      const start = item.part.time?.created
      const end = item.part.time?.completed
      return total + (start === undefined || end === undefined ? 0 : Math.max(0, end - start))
    }, 0),
  )
  const grouped = () => (props.node.kind === "reasoning" ? ctx.thinkingMode() === "hide" : ctx.groupExploration())
  const completed = () =>
    props.node.kind === "reasoning"
      ? props.completed
      : props.completed || (tools().length > 0 && tools().every((part) => part.time.completed !== undefined))
  const label = createMemo(() => {
    const counts = tools().reduce<Record<string, number>>((result, part) => {
      const tool = toolDisplay(part.name)
      const name = tool === "grep" || tool === "glob" ? "search" : tool
      result[name] = (result[name] ?? 0) + 1
      return result
    }, {})
    const names = Object.entries(counts).map(
      ([name, count]) => `${count} ${count === 1 ? name : name === "search" ? "searches" : `${name}s`}`,
    )
    return `${completed() ? "Explored" : "Exploring"} — ${names.join(", ")}`
  })
  const toggle = () => {
    if (renderer.getSelection()?.getSelectedText()) return
    const key = id()
    if (key) ctx.setGroupExpanded(key, !expanded())
  }
  const children = (mode: "normal" | "thought" | "tool") => (
    <Children {...props} nodes={props.node.children} mode={mode} />
  )

  return (
    <GroupAnchor
      groupID={id()}
      active={grouped() && (props.node.kind === "reasoning" ? thoughts().length > 0 : tools().length > 0)}
    >
      <Show
        when={props.node.kind === "reasoning"}
        fallback={
          <Show when={grouped()} fallback={children("normal")}>
            <Show when={tools().length > 0}>
              <InlineToolRow
                icon={completed() ? "→" : "✱"}
                color={hover() ? theme.text.default : theme.text.subdued}
                complete={completed()}
                pending={label()}
                spinner={!completed()}
                onMouseOver={() => setHover(true)}
                onMouseOut={() => setHover(false)}
                onMouseUp={toggle}
              >
                {label()}
              </InlineToolRow>
            </Show>
            <Show when={expanded() && tools().length > 0}>{children("tool")}</Show>
            <Show when={!props.imagesOutside}>{props.images(tools())}</Show>
          </Show>
        }
      >
        <Show when={thoughts().length > 0}>
          <Show when={grouped()} fallback={children("normal")}>
            <InlineToolRow
              icon={expanded() ? "-" : "+"}
              color={
                !props.completed
                  ? theme.text.default
                  : hover() || expanded()
                    ? theme.text.feedback.warning.default
                    : RGBA.fromValues(
                        theme.text.feedback.warning.default.r,
                        theme.text.feedback.warning.default.g,
                        theme.text.feedback.warning.default.b,
                        0.6,
                      )
              }
              complete={props.completed}
              pending={latest() ? `Thinking: ${latest()}` : "Thinking"}
              spinner={!props.completed}
              onMouseOver={() => setHover(true)}
              onMouseOut={() => setHover(false)}
              onMouseUp={toggle}
            >
              {props.completed ? "Thought" : latest() ? `Thinking: ${latest()}` : "Thinking"}
              <Show when={props.completed && !expanded() && latest()}>: {latest()}</Show>
              <Show when={props.completed && thoughts().length > 1}> · {thoughts().length} steps</Show>
              <Show when={props.completed && duration()}> · {Locale.duration(duration())}</Show>
            </InlineToolRow>
            <Show when={expanded()}>
              <box paddingLeft={3}>{children("thought")}</box>
            </Show>
          </Show>
        </Show>
      </Show>
      <Show when={!props.pendingOutside}>
        <For each={props.pending}>
          {(ref) => {
            const leaf = createMemo(() => {
              return entries().find(
                (entry) =>
                  entry.type === "part" && entry.ref.messageID === ref.messageID && entry.ref.partID === ref.partID,
              )
            })
            return (
              <Show when={leaf()}>{(item) => <EntryAnchor entry={item()}>{props.entry(item())}</EntryAnchor>}</Show>
            )
          }}
        </For>
      </Show>
    </GroupAnchor>
  )
}

function Children(props: GroupProps & { nodes: readonly SessionNode[]; mode: "normal" | "thought" | "tool" }) {
  return (
    <For each={props.nodes}>
      {(node, index) => {
        return (
          <Switch>
            <Match when={node.type === "group" ? node : undefined}>
              {(node) => (
                <Group
                  {...props}
                  node={node()}
                  level={props.level + 1}
                  pendingOutside
                  imagesOutside={props.imagesOutside || props.mode === "tool"}
                  completed={
                    props.completed ||
                    props.nodes
                      .slice(index() + 1)
                      .some((next) => next.type === "group" || !isPending(next.entry, props.pending)) ||
                    (node().kind === "reasoning" && reasoningCompleted(node().children, props.message))
                  }
                />
              )}
            </Match>
            <Match when={node.type === "entry" ? node : undefined}>
              {(node) => (
                <Show when={!isPending(node().entry, props.pending)}>
                  <Show
                    when={props.mode === "thought"}
                    fallback={
                      <EntryAnchor entry={node().entry}>
                        {props.entry(node().entry, props.mode === "tool" ? false : undefined)}
                      </EntryAnchor>
                    }
                  >
                    <ThoughtEntry entry={node().entry} message={props.message} />
                  </Show>
                </Show>
              )}
            </Match>
          </Switch>
        )
      }}
    </For>
  )
}

function ThoughtEntry(props: { entry: SessionEntry; message: Renderers["message"] }) {
  const ctx = use()
  const theme = useTheme()
  const { currentSyntax: syntax } = useThemes()
  const thinkingSyntax = createSyntaxStyleMemo(() => generateThinkingSyntax(syntax(), theme.text.subdued))
  const message = createMemo(() => {
    if (props.entry.type !== "part") return
    const item = props.message(props.entry.ref.messageID)
    return item?.type === "assistant" ? item : undefined
  })
  const part = createMemo(() => {
    const item = message()
    if (!item || props.entry.type !== "part") return
    const part = resolvePart(item, props.entry.ref.partID)
    return part?.type === "reasoning" ? part : undefined
  })
  const content = createMemo(() => {
    const item = part()
    return item ? reasoningContent(item) : ""
  })
  return (
    <Show when={content()}>
      <EntryAnchor entry={props.entry} marginTop={1}>
        <box
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={theme.raise(theme.background.surface.offset)}
          paddingLeft={1}
        >
          <code
            filetype="markdown"
            drawUnstyledText={false}
            streaming={part()?.time?.completed === undefined && message()?.time.completed === undefined}
            syntaxStyle={thinkingSyntax()}
            content={content()}
            conceal={ctx.markdownMode() === "rendered"}
            fg={theme.text.subdued}
          />
        </box>
      </EntryAnchor>
    </Show>
  )
}

function isPending(entry: SessionEntry, pending: readonly PartRef[]) {
  return (
    entry.type === "part" &&
    pending.some((ref) => ref.messageID === entry.ref.messageID && ref.partID === entry.ref.partID)
  )
}

function reasoningCompleted(nodes: readonly SessionNode[], message: Renderers["message"]): boolean {
  return nodes.every((node) => {
    if (node.type === "group") return reasoningCompleted(node.children, message)
    if (node.entry.type !== "part") return false
    const item = message(node.entry.ref.messageID)
    if (item?.type !== "assistant") return false
    const part = resolvePart(item, node.entry.ref.partID)
    return part?.type === "reasoning" && part.time?.completed !== undefined
  })
}
