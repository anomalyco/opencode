import { createMemo, createEffect, on, onCleanup, For, Show } from "solid-js"
import type { JSX } from "solid-js"
import { useParams } from "@solidjs/router"
import { DateTime } from "luxon"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { checksum } from "@opencode-ai/util/encode"
import { Icon } from "@opencode-ai/ui/icon"
import { Accordion } from "@opencode-ai/ui/accordion"
import { StickyAccordionHeader } from "@opencode-ai/ui/sticky-accordion-header"
import { Code } from "@opencode-ai/ui/code"
import { Markdown } from "@opencode-ai/ui/markdown"
import type { AssistantMessage, Message, Part, UserMessage } from "@opencode-ai/sdk/v2/client"

interface SessionContextTabProps {
  messages: () => Message[]
  visibleUserMessages: () => UserMessage[]
  view: () => ReturnType<ReturnType<typeof useLayout>["view"]>
  info: () => ReturnType<ReturnType<typeof useSync>["session"]["get"]>
}

export function SessionContextTab(props: SessionContextTabProps) {
  const params = useParams()
  const sync = useSync()

  const ctx = createMemo(() => {
    const last = props.messages().findLast((x) => {
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
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
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
    const msg = props.visibleUserMessages().findLast((m) => !!m.system)
    const system = msg?.system
    if (!system) return
    const trimmed = system.trim()
    if (!trimmed) return
    return trimmed
  })

  const number = (value: number | null | undefined) => {
    if (value === undefined) return "—"
    if (value === null) return "—"
    return value.toLocaleString()
  }

  const percent = (value: number | null | undefined) => {
    if (value === undefined) return "—"
    if (value === null) return "—"
    return value.toString() + "%"
  }

  const time = (value: number | undefined) => {
    if (!value) return "—"
    return DateTime.fromMillis(value).toLocaleString(DateTime.DATETIME_MED)
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
                out.tool += Object.keys(part.state.input).length * 16
                if (part.state.status === "pending") out.tool += part.state.raw.length
                if (part.state.status === "completed") out.tool += part.state.output.length
                if (part.state.status === "error") out.tool += part.state.error.length
              }
            }
          }
        }

        const estimateTokens = (chars: number) => Math.ceil(chars / 4)
        const system = estimateTokens(out.system)
        const user = estimateTokens(out.user)
        const assistant = estimateTokens(out.assistant)
        const tool = estimateTokens(out.tool)
        const estimated = system + user + assistant + tool

        const pct = (tokens: number) => (tokens / input) * 100
        const pctLabel = (tokens: number) => (Math.round(pct(tokens) * 10) / 10).toString() + "%"

        const build = (tokens: { system: number; user: number; assistant: number; tool: number; other: number }) => {
          return [
            {
              key: "system",
              label: "System",
              tokens: tokens.system,
              width: pct(tokens.system),
              percent: pctLabel(tokens.system),
              color: "var(--syntax-info)",
            },
            {
              key: "user",
              label: "User",
              tokens: tokens.user,
              width: pct(tokens.user),
              percent: pctLabel(tokens.user),
              color: "var(--syntax-success)",
            },
            {
              key: "assistant",
              label: "Assistant",
              tokens: tokens.assistant,
              width: pct(tokens.assistant),
              percent: pctLabel(tokens.assistant),
              color: "var(--syntax-property)",
            },
            {
              key: "tool",
              label: "Tool Calls",
              tokens: tokens.tool,
              width: pct(tokens.tool),
              percent: pctLabel(tokens.tool),
              color: "var(--syntax-warning)",
            },
            {
              key: "other",
              label: "Other",
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
      { label: "Session", value: props.info()?.title ?? params.id ?? "—" },
      { label: "Messages", value: count.all.toLocaleString() },
      { label: "Provider", value: providerLabel() },
      { label: "Model", value: modelLabel() },
      { label: "Context Limit", value: number(c?.limit) },
      { label: "Total Tokens", value: number(c?.total) },
      { label: "Usage", value: percent(c?.usage) },
      { label: "Input Tokens", value: number(c?.input) },
      { label: "Output Tokens", value: number(c?.output) },
      { label: "Reasoning Tokens", value: number(c?.reasoning) },
      { label: "Cache Tokens (read/write)", value: `${number(c?.cacheRead)} / ${number(c?.cacheWrite)}` },
      { label: "User Messages", value: count.user.toLocaleString() },
      { label: "Assistant Messages", value: count.assistant.toLocaleString() },
      { label: "Total Cost", value: cost() },
      { label: "Session Created", value: time(props.info()?.time.created) },
      { label: "Last Activity", value: time(c?.message.time.created) },
    ] satisfies { label: string; value: JSX.Element }[]
  })

  function RawMessageContent(msgProps: { message: Message }) {
    const file = createMemo(() => {
      const parts = (sync.data.part[msgProps.message.id] ?? []) as Part[]
      const contents = JSON.stringify({ message: msgProps.message, parts }, null, 2)
      return {
        name: `${msgProps.message.role}-${msgProps.message.id}.json`,
        contents,
        cacheKey: checksum(contents),
      }
    })

    return <Code file={file()} overflow="wrap" class="select-text" />
  }

  function RawMessage(msgProps: { message: Message }) {
    return (
      <Accordion.Item value={msgProps.message.id}>
        <StickyAccordionHeader>
          <Accordion.Trigger>
            <div class="flex items-center justify-between gap-2 w-full">
              <div class="min-w-0 truncate">
                {msgProps.message.role} <span class="text-text-base">• {msgProps.message.id}</span>
              </div>
              <div class="flex items-center gap-3">
                <div class="shrink-0 text-12-regular text-text-weak">{time(msgProps.message.time.created)}</div>
                <Icon name="chevron-grabber-vertical" size="small" class="shrink-0 text-text-weak" />
              </div>
            </div>
          </Accordion.Trigger>
        </StickyAccordionHeader>
        <Accordion.Content class="bg-background-base">
          <div class="p-3">
            <RawMessageContent message={msgProps.message} />
          </div>
        </Accordion.Content>
      </Accordion.Item>
    )
  }

  let scroll: HTMLDivElement | undefined
  let frame: number | undefined
  let pending: { x: number; y: number } | undefined

  const restoreScroll = (retries = 0) => {
    const el = scroll
    if (!el) return

    const s = props.view()?.scroll("context")
    if (!s) return

    // Wait for content to be scrollable - content may not have rendered yet
    if (el.scrollHeight <= el.clientHeight && retries < 10) {
      requestAnimationFrame(() => restoreScroll(retries + 1))
      return
    }

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
      <div class="px-6 pt-4 flex flex-col gap-10">
        <div class="grid grid-cols-1 @[32rem]:grid-cols-2 gap-4">
          <For each={stats()}>{(stat) => <Stat label={stat.label} value={stat.value} />}</For>
        </div>

        <Show when={breakdown().length > 0}>
          <div class="flex flex-col gap-2">
            <div class="text-12-regular text-text-weak">Context Breakdown</div>
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
            <div class="hidden text-11-regular text-text-weaker">
              Approximate breakdown of input tokens. "Other" includes tool definitions and overhead.
            </div>
          </div>
        </Show>

        <Show when={systemPrompt()}>
          {(prompt) => (
            <div class="flex flex-col gap-2">
              <div class="text-12-regular text-text-weak">System Prompt</div>
              <div class="border border-border-base rounded-md bg-surface-base px-3 py-2">
                <Markdown text={prompt()} class="text-12-regular" />
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-col gap-2">
          <div class="text-12-regular text-text-weak">Raw messages</div>
          <Accordion multiple>
            <For each={props.messages()}>{(message) => <RawMessage message={message} />}</For>
          </Accordion>
        </div>
      </div>
    </div>
  )
}
