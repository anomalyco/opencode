import type { JSX } from "solid-js"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { checksum } from "@opencode-ai/util/encode"
import { findLast } from "@opencode-ai/util/array"
import { Icon } from "@opencode-ai/ui/icon"
import { Tabs } from "@opencode-ai/ui/tabs"
import { Accordion } from "@opencode-ai/ui/accordion"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { Code } from "@opencode-ai/ui/code"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { AssistantMessage, Message, Part, ToolPart, UserMessage, ToolState } from "@opencode-ai/sdk/v2/client"
import { useLanguage } from "@/context/language"

interface SessionContextTabProps {
  messages: () => Message[]
  visibleUserMessages: () => UserMessage[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  info: () => ReturnType<ReturnType<typeof useSync>["session"]["get"]>
}

export function SessionContextTab(props: SessionContextTabProps) {
  const params = useParams()
  const sync = useSync()
  const language = useLanguage()
  const [contextSubTab, setContextSubTab] = createSignal<"context" | "tools">("context")

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.locale(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const ctx = createMemo(() => {
    const last = findLast(props.messages(), (x) => {
      if (x.role !== "assistant") return false
      const total = x.tokens.input + x.tokens.output + x.tokens.reasoning + x.tokens.cache.read + x.tokens.cache.write
      return total > 0
    }) as AssistantMessage
    if (!last) return

    const provider = sync.data.provider.all.find((x) => x.id === last.providerID)
    const model = provider?.models[last.modelID]
    const limit = model?.limit.context

    const input = last.tokens.input
    const output = last.tokens.output
    const reasoning = last.tokens.reasoning
    const cacheRead = last.tokens.cache.read
    const cacheWrite = last.tokens.cache.write
    const total = input + output + reasoning + cacheRead + cacheWrite
    const usage = limit ? Math.round((total / limit) * 100) : null

    return {
      message: last,
      provider,
      model,
      limit,
      input,
      output,
      reasoning,
      cacheRead,
      cacheWrite,
      total,
      usage,
    }
  })

  const cost = createMemo(() => {
    const total = props.messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return usd().format(total)
  })

  const counts = createMemo(() => {
    const all = props.messages()
    const user = all.reduce((count, x) => count + (x.role === "user" ? 1 : 0), 0)
    const assistant = all.reduce((count, x) => count + (x.role === "assistant" ? 1 : 0), 0)
    return {
      all: all.length,
      user,
      assistant,
    }
  })

  const systemPrompt = createMemo(() => {
    const msg = findLast(props.visibleUserMessages(), (m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const getEstimateTokens = (chars: number) => {
    return Math.ceil(chars / 4)
  }

  const getToolOutput = (toolState: ToolState) => {
    switch (toolState.status) {
      case "completed":
        return toolState.output
      case "error":
        return toolState.error
      case "pending":
        return toolState.raw
      default:
        return ""
    }
  }

  const getCharactersCountFromToolPart = (toolPart: ToolPart) => {
    let chars = 0
    chars += Object.keys(toolPart.state.input).length * 16
    chars += getToolOutput(toolPart.state).length
    return chars
  }

  const number = (value: number | null | undefined) => {
    if (value === undefined) return "—"
    if (value === null) return "—"
    return value.toLocaleString(language.locale())
  }

  const percent = (value: number | null | undefined) => {
    if (value === undefined) return "—"
    if (value === null) return "—"
    return value.toLocaleString(language.locale()) + "%"
  }

  const time = (value: number | undefined) => {
    if (!value) return "—"
    return DateTime.fromMillis(value).setLocale(language.locale()).toLocaleString(DateTime.DATETIME_MED)
  }

  const providerLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    return c.provider?.name ?? c.message.providerID
  })

  const modelLabel = createMemo(() => {
    const c = ctx()
    if (!c) return "—"
    if (c.model?.name) return c.model.name
    return c.message.modelID
  })

  const breakdown = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, props.messages().length, systemPrompt()],
      () => {
        const c = ctx()
        if (!c) return []
        const input = c.input
        if (!input) return []

        const out = {
          system: systemPrompt()?.length ?? 0,
          user: 0,
          assistant: 0,
          tool: 0,
        }

        for (const msg of props.messages()) {
          const parts = (sync.data.part[msg.id] ?? []) as Part[]

          if (msg.role === "user") {
            for (const part of parts) {
              if (part.type === "text") out.user += part.text.length
              if (part.type === "file") out.user += part.source?.text.value.length ?? 0
              if (part.type === "agent") out.user += part.source?.value.length ?? 0
            }
            continue
          }

          if (msg.role === "assistant") {
            for (const part of parts) {
              if (part.type === "text") out.assistant += part.text.length
              if (part.type === "reasoning") out.assistant += part.text.length
              if (part.type === "tool") {
                const toolPart = part as ToolPart
                out.tool += getCharactersCountFromToolPart(toolPart)
              }
            }
          }
        }
        const system = getEstimateTokens(out.system)
        const user = getEstimateTokens(out.user)
        const assistant = getEstimateTokens(out.assistant)
        const tool = getEstimateTokens(out.tool)
        const estimated = system + user + assistant + tool

        const pct = (tokens: number) => (tokens / input) * 100
        const pctLabel = (tokens: number) => (Math.round(pct(tokens) * 10) / 10).toString() + "%"

        const build = (tokens: { system: number; user: number; assistant: number; tool: number; other: number }) => {
          return [
            {
              key: "system",
              label: language.t("context.breakdown.system"),
              tokens: tokens.system,
              width: pct(tokens.system),
              percent: pctLabel(tokens.system),
              color: "var(--syntax-info)",
            },
            {
              key: "user",
              label: language.t("context.breakdown.user"),
              tokens: tokens.user,
              width: pct(tokens.user),
              percent: pctLabel(tokens.user),
              color: "var(--syntax-success)",
            },
            {
              key: "assistant",
              label: language.t("context.breakdown.assistant"),
              tokens: tokens.assistant,
              width: pct(tokens.assistant),
              percent: pctLabel(tokens.assistant),
              color: "var(--syntax-property)",
            },
            {
              key: "tool",
              label: language.t("context.breakdown.tool"),
              tokens: tokens.tool,
              width: pct(tokens.tool),
              percent: pctLabel(tokens.tool),
              color: "var(--syntax-warning)",
            },
            {
              key: "other",
              label: language.t("context.breakdown.other"),
              tokens: tokens.other,
              width: pct(tokens.other),
              percent: pctLabel(tokens.other),
              color: "var(--syntax-comment)",
            },
          ].filter((x) => x.tokens > 0)
        }

        if (estimated <= input) {
          return build({ system, user, assistant, tool, other: input - estimated })
        }

        const scale = input / estimated
        const scaled = {
          system: Math.floor(system * scale),
          user: Math.floor(user * scale),
          assistant: Math.floor(assistant * scale),
          tool: Math.floor(tool * scale),
        }
        const scaledTotal = scaled.system + scaled.user + scaled.assistant + scaled.tool
        return build({ ...scaled, other: Math.max(0, input - scaledTotal) })
      },
    ),
  )

  const toolsEntries = createMemo(
    on(
      () => [ctx()?.message.id, ctx()?.input, props.messages().length],
      () => {
        const c = ctx()
        if (!c) return []
        const input = c.input
        if (!input) return []

        const toolUsage = new Map<string, { tokens: number; calls: number }>()

        for (const msg of props.messages()) {
          if (msg.role !== "assistant") continue

          const parts = (sync.data.part[msg.id] ?? []) as Part[]

          for (const part of parts) {
            if (part.type === "tool") {
              const toolPart = part as ToolPart
              const toolName = toolPart.tool

              const chars = getCharactersCountFromToolPart(toolPart)
              const estimateTokens = getEstimateTokens(chars)

              const existing = toolUsage.get(toolName) ?? { tokens: 0, calls: 0 }
              toolUsage.set(toolName, { tokens: existing.tokens + estimateTokens, calls: existing.calls + 1 })
            }
          }
        }

        const entries = Array.from(toolUsage.entries())
          .map(([toolName, data]) => ({
            toolName,
            tokens: data.tokens,
            calls: data.calls,
          }))
          .filter((x) => x.tokens > 0)
          .sort((a, b) => b.tokens - a.tokens)

        const totalToolTokens = entries.reduce((sum, x) => sum + x.tokens, 0)

        const pct = (tokens: number) => (tokens / totalToolTokens) * 100
        const pctLabel = (tokens: number) => (Math.round(pct(tokens) * 10) / 10).toString() + "%"

        return entries.map((entry) => ({
            ...entry,
            width: pct(entry.tokens),
            percent: pctLabel(entry.tokens),
          }))
      },
    )
  )

  const toolsHistory = createMemo(() => {
    const calls: {
      toolName: string
      callID: string
      messageId: string
      messageTime: number
      tokens: number
      status: "pending" | "running" | "completed" | "error"
      part: ToolPart
    }[] = []

    for (const msg of props.messages()) {
      if (msg.role !== "assistant") continue

      const parts = (sync.data.part[msg.id] ?? []) as Part[]

      for (const part of parts) {
        if (part.type === "tool") {
          const toolPart = part as ToolPart
          let chars = getCharactersCountFromToolPart(toolPart)

          calls.push({
            toolName: toolPart.tool,
            callID: toolPart.callID,
            messageId: msg.id,
            messageTime: msg.time.created,
            tokens: getEstimateTokens(chars),
            status: toolPart.state.status,
            part: toolPart,
          })
        }
      }
    }

    return calls.sort((a, b) => a.messageTime - b.messageTime)
  })

  function Stat(statProps: { label: string; value: JSX.Element }) {
    return (
      <div class="flex flex-col gap-1">
        <div class="text-12-regular text-text-weak">{statProps.label}</div>
        <div class="text-12-medium text-text-strong">{statProps.value}</div>
      </div>
    )
  }

  const stats = createMemo(() => {
    const c = ctx()
    const count = counts()
    return [
      { label: language.t("context.stats.session"), value: props.info()?.title ?? params.id ?? "—" },
      { label: language.t("context.stats.messages"), value: count.all.toLocaleString(language.locale()) },
      { label: language.t("context.stats.provider"), value: providerLabel() },
      { label: language.t("context.stats.model"), value: modelLabel() },
      { label: language.t("context.stats.limit"), value: number(c?.limit) },
      { label: language.t("context.stats.totalTokens"), value: number(c?.total) },
      { label: language.t("context.stats.usage"), value: percent(c?.usage) },
      { label: language.t("context.stats.inputTokens"), value: number(c?.input) },
      { label: language.t("context.stats.outputTokens"), value: number(c?.output) },
      { label: language.t("context.stats.reasoningTokens"), value: number(c?.reasoning) },
      {
        label: language.t("context.stats.cacheTokens"),
        value: `${number(c?.cacheRead)} / ${number(c?.cacheWrite)}`,
      },
      { label: language.t("context.stats.userMessages"), value: count.user.toLocaleString(language.locale()) },
      {
        label: language.t("context.stats.assistantMessages"),
        value: count.assistant.toLocaleString(language.locale()),
      },
      { label: language.t("context.stats.totalCost"), value: cost() },
      { label: language.t("context.stats.sessionCreated"), value: time(props.info()?.time.created) },
      { label: language.t("context.stats.lastActivity"), value: time(c?.message.time.created) },
    ] satisfies { label: string; value: JSX.Element }[]
  })

  // Universal component for expandable accordion items
  function ExpandableItem(props: {
    value: string
    title: JSX.Element
    badges?: JSX.Element
    time?: number
    children: JSX.Element
  }) {
    return (
      <Accordion.Item value={props.value}>
        <StickyAccordionHeader>
          <Accordion.Trigger>
            <div class="flex items-center justify-between gap-2 w-full">
              <div class="min-w-0 truncate flex items-center gap-2">
                {props.title}
                <Show when={props.badges}>{props.badges}</Show>
              </div>
              <div class="flex items-center gap-3">
                <Show when={props.time !== undefined}>
                  <div class="shrink-0 text-12-regular text-text-weak">{time(props.time)}</div>
                </Show>
                <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-text-weak" />
              </div>
            </div>
          </Accordion.Trigger>
        </StickyAccordionHeader>
        <Accordion.Content class="bg-background-base">
          <div class="p-3">{props.children}</div>
        </Accordion.Content>
      </Accordion.Item>
    )
  }

  // Universal component for JSON display with syntax highlighting
  function JsonView(props: { name: string; data: unknown }) {
    const file = createMemo(() => {
      const contents = JSON.stringify(props.data, null, 2)
      return {
        name: props.name,
        contents,
        cacheKey: checksum(contents),
      }
    })

    return (
      <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
        <Code
          file={file()}
          overflow="wrap"
          class="select-text"
          onRendered={() => requestAnimationFrame(restoreScroll)}
        />
      </div>
    )
  }

  function RawMessageContent(msgProps: { message: Message }) {
    const data = createMemo(() => {
      const parts = (sync.data.part[msgProps.message.id] ?? []) as Part[]
      return { message: msgProps.message, parts }
    })

    return <JsonView name={`${msgProps.message.role}-${msgProps.message.id}.json`} data={data()} />
  }

  function RawMessage(msgProps: { message: Message }) {
    return (
      <ExpandableItem
        value={msgProps.message.id}
        title={
          <>
            {msgProps.message.role} <span class="text-text-base">• {msgProps.message.id}</span>
          </>
        }
        time={msgProps.message.time.created}
      >
        <RawMessageContent message={msgProps.message} />
      </ExpandableItem>
    )
  }

  function ToolCallContent(props: { part: ToolPart }) {
    const inputKeys = () => Object.keys(props.part.state.input)

    const estimatedTokens = getEstimateTokens(getCharactersCountFromToolPart(props.part))

    return (
      <div class="flex flex-col gap-3">
        <div class="grid grid-cols-2 gap-3">
          <div class="flex flex-col gap-1">
            <div class="text-11-regular text-text-weak uppercase">Status</div>
            <div class="text-12-regular text-text-strong">{props.part.state.status}</div>
          </div>
          <div class="flex flex-col gap-1">
            <div class="text-11-regular text-text-weak uppercase">Tokens (est.)</div>
            <div class="text-12-regular text-text-strong">{estimatedTokens}</div>
          </div>
        </div>

        <Show when={inputKeys().length > 0}>
          <div class="flex flex-col gap-1">
            <div class="text-11-regular text-text-weak uppercase">Input</div>
            <JsonView name="input.json" data={props.part.state.input} />
          </div>
        </Show>

        <Show when={props.part.state.status === "completed" || props.part.state.status === "error"}>
          <div class="flex flex-col gap-1">
            <div class="text-11-regular text-text-weak uppercase">
              {props.part.state.status === "error" ? "Error" : "Output"}
            </div>
            <JsonView name={props.part.state.status === "error" ? "error.txt" : "output.txt"} data={getToolOutput(props.part.state)} />
          </div>
        </Show>

        <div class="flex flex-col gap-1">
          <div class="text-11-regular text-text-weak uppercase">Raw Data</div>
          <JsonView name={`${props.part.tool}-${props.part.callID}.json`} data={props.part} />
        </div>
      </div>
    )
  }

  function ToolCall(props: { call: ReturnType<typeof toolsHistory>[number] }) {
    const badges = (
      <div class="flex items-center gap-3">
        <div class="text-12-regular text-text-weak">{number(props.call.tokens)} tokens</div>
      </div>
    )

    return (
      <ExpandableItem
        value={props.call.callID}
        title={
          <>
            <span class="text-text-strong">{props.call.toolName}</span>
          </>
        }
        badges={badges}
        time={props.call.messageTime}
      >
        <ToolCallContent part={props.call.part} />
      </ExpandableItem>
    )
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = () => {
    const el = scroll
    if (!el) return

    const s = props.view()?.scroll("context")
    if (!s) return

    if (el.scrollTop !== s.y) el.scrollTop = s.y
    if (el.scrollLeft !== s.x) el.scrollLeft = s.x
  }

  const handleScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pending = {
      x: event.currentTarget.scrollLeft,
      y: event.currentTarget.scrollTop,
    }
    if (frame !== undefined) return

    frame = requestAnimationFrame(() => {
      frame = undefined

      const next = pending
      pending = undefined
      if (!next) return

      props.view().setScroll("context", next)
    })
  }

  createEffect(
    on(
      () => props.messages().length,
      () => {
        requestAnimationFrame(restoreScroll)
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
  })

  return (
    <div
      class="@container h-full overflow-y-auto no-scrollbar pb-10"
      ref={(el) => {
        scroll = el
        restoreScroll()
      }}
      onScroll={handleScroll}
    >
      <div class="px-6 pt-4 flex flex-col gap-6">
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
          <For each={stats()}>{(stat) => <Stat label={stat.label} value={stat.value} />}</For>
        </div>

        <Tabs value={contextSubTab()} onChange={(v) => setContextSubTab(v as "context" | "tools")} variant="pill">
          <Tabs.List class="w-fit">
            <Tabs.Trigger value="context" class="px-3 py-1.5">
              <div class="text-12-medium">{language.t("context.tab.context")}</div>
            </Tabs.Trigger>
            <Tabs.Trigger value="tools" class="px-3 py-1.5">
              <div class="text-12-medium">{language.t("context.tab.tools")}</div>
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="context" class="flex flex-col gap-10 mt-6">
            <Show when={breakdown().length > 0}>
              <div class="flex flex-col gap-2">
                <div class="text-12-regular text-text-weak">{language.t("context.breakdown.title")}</div>
                <div class="h-2 w-full rounded-full bg-surface-base overflow-hidden flex">
                  <For each={breakdown()}>
                    {(segment) => (
                      <div
                        class="h-full"
                        style={{
                          width: `${segment.width}%`,
                          "background-color": segment.color,
                        }}
                      />
                    )}
                  </For>
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-1">
                  <For each={breakdown()}>
                    {(segment) => (
                      <div class="flex items-center gap-1 text-11-regular text-text-weak">
                        <div class="size-2 rounded-sm" style={{ "background-color": segment.color }} />
                        <div>{segment.label}</div>
                        <div class="text-text-weaker">{segment.percent}</div>
                      </div>
                    )}
                  </For>
                </div>
                <div class="hidden text-11-regular text-text-weaker">{language.t("context.breakdown.note")}</div>
              </div>
            </Show>

            <Show when={systemPrompt()}>
              {(prompt) => (
                <div class="flex flex-col gap-2">
                  <div class="text-12-regular text-text-weak">{language.t("context.systemPrompt.title")}</div>
                  <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
                    <Markdown text={prompt()} class="text-12-regular" />
                  </div>
                </div>
              )}
            </Show>

            <div class="flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">{language.t("context.rawMessages.title")}</div>
              <Accordion multiple>
                <For each={props.messages()}>{(message) => <RawMessage message={message} />}</For>
              </Accordion>
            </div>
          </Tabs.Content>

          <Tabs.Content value="tools" class="flex flex-col gap-6 mt-6">
            <Show
              when={toolsEntries().length > 0}
              fallback={
                <div class="text-12-regular text-text-weak text-center py-10">{language.t("context.tools.empty")}</div>
              }
            >
              <div class="flex flex-col gap-2">
                <div class="text-12-regular text-text-weak">{language.t("context.tools.title")}</div>
                <div class="h-2 w-full rounded-full bg-surface-base overflow-hidden flex">
                  <For each={toolsEntries()}>
                    {(entry, index) => (
                      <div
                        class="h-full first:rounded-l-full last:rounded-r-full"
                        style={{
                          width: `${entry.width}%`,
                          "background-color": `hsl(${(index() * 37) % 360}, 70%, 50%)`,
                        }}
                      />
                    )}
                  </For>
                </div>
                <div class="flex flex-wrap gap-x-3 gap-y-1">
                  <For each={toolsEntries()}>
                    {(entry, index) => (
                      <div class="flex items-center gap-1 text-11-regular text-text-weak">
                        <div
                          class="size-2 rounded-sm"
                          style={{ "background-color": `hsl(${(index() * 37) % 360}, 70%, 50%)` }}
                        />
                        <div>{entry.toolName}</div>
                        <div class="text-text-weaker">{entry.percent}</div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                <div class="text-12-regular text-text-weak">{language.t("context.tools.details")}</div>
                <div class="border border-border-base rounded-md bg-surface-base overflow-hidden">
                  <div class="grid grid-cols-3 px-3 py-2 border-b border-border-base bg-surface-weak">
                    <div class="text-11-medium text-text-weak">Tool</div>
                    <div class="text-11-medium text-text-weak text-right">Tokens</div>
                    <div class="text-11-medium text-text-weak text-right">Calls</div>
                  </div>
                  <For each={toolsEntries()}>
                    {(entry, index) => (
                      <div class="grid grid-cols-3 px-3 py-2 border-b border-border-base last:border-0">
                        <div class="flex items-center gap-2">
                          <div
                            class="size-2 rounded-sm shrink-0"
                            style={{ "background-color": `hsl(${(index() * 37) % 360}, 70%, 50%)` }}
                          />
                          <div class="text-12-regular text-text-strong truncate">{entry.toolName}</div>
                        </div>
                        <div class="text-12-regular text-text-base text-right">{number(entry.tokens)}</div>
                        <div class="text-12-regular text-text-base text-right">{entry.calls}</div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              <div class="flex flex-col gap-2">
                <div class="text-12-regular text-text-weak">{language.t("context.tools.history")}</div>
                <Accordion multiple>
                  <For each={toolsHistory()}>{(call) => <ToolCall call={call} />}</For>
                </Accordion>
              </div>
            </Show>
          </Tabs.Content>
        </Tabs>
      </div>
    </div>
  )
}
