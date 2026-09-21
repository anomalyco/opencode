import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import type { NativeUsage } from "./native-types"
import { tokenTotal } from "./telemetry"
import {
  AGENT_ROWS_VIRTUALIZE_THRESHOLD,
  type ExecutionAgent,
  type ExecutionAgentRole,
  type ExecutionAgentRow,
  type ExecutionAgentState,
  type ExecutionModel,
} from "./model"

const ROW_HEIGHT = 44
const OVERSCAN_PX = ROW_HEIGHT * 2
const FALLBACK_VIEWPORT = 600

const STATE_ICONS: Record<ExecutionAgentState, string> = {
  running: "refresh",
  idle: "status",
  needs_input: "help",
  error: "circle-exclamation",
  unknown: "info",
}

export function ExecutionAgentList(props: { model: ExecutionModel }) {
  const language = useLanguage()
  const rows = createMemo(() => props.model.agentRows())
  const [focusedID, setFocusedID] = createSignal<string | undefined>()
  const [pendingFocus, setPendingFocus] = createSignal<string | undefined>()
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewport, setViewport] = createSignal(FALLBACK_VIEWPORT)
  const [heights, setHeights] = createSignal<Record<string, number>>({})
  const elements = new Map<string, HTMLElement>()
  let scroller: HTMLDivElement | undefined

  const layout = createMemo(() => {
    const measured = heights()
    const offsets: number[] = []
    const sizes: number[] = []
    let total = 0
    for (const row of rows()) {
      const size = measured[row.agent.id] ?? ROW_HEIGHT
      offsets.push(total)
      sizes.push(size)
      total += size
    }
    return { offsets, sizes, total }
  })

  const virtualized = createMemo(() => rows().length > AGENT_ROWS_VIRTUALIZE_THRESHOLD)
  const window = createMemo(() => {
    const total = rows().length
    if (!virtualized()) return { start: 0, end: total }
    const { offsets } = layout()
    const start = Math.max(0, rowAt(offsets, scrollTop() - OVERSCAN_PX) - 1)
    const end = Math.min(total, rowAt(offsets, scrollTop() + viewport()) + 2)
    return { start, end }
  })
  const visible = createMemo(() => rows().slice(window().start, window().end))
  const paddingTop = createMemo(() => (virtualized() ? layout().offsets[window().start] ?? 0 : 0))
  const paddingBottom = createMemo(() => {
    if (!virtualized()) return 0
    const { offsets, sizes, total } = layout()
    const last = window().end - 1
    if (last < 0) return 0
    return total - ((offsets[last] ?? 0) + (sizes[last] ?? ROW_HEIGHT))
  })

  const register = (sessionID: string, element: HTMLElement) => {
    elements.set(sessionID, element)
    onCleanup(() => elements.delete(sessionID))
  }

  createResizeObserver(
    () =>
      visible().flatMap((row) => {
        const element = elements.get(row.agent.id)
        return element ? [element] : []
      }),
    (_rect, element) => {
      const id = element.dataset.agentId
      if (!id) return
      const height = Math.round(element.getBoundingClientRect().height)
      if (height > 0 && heights()[id] !== height) setHeights((previous) => ({ ...previous, [id]: height }))
    },
  )

  createEffect(() => {
    visible()
    const id = pendingFocus()
    if (!id) return
    const element = document.getElementById(`execution-agent-${id}`)
    if (!element) return
    element.focus()
    setPendingFocus(undefined)
  })

  onMount(() => {
    if (scroller?.clientHeight) setViewport(scroller.clientHeight)
  })

  const focusRow = (index: number) => {
    const row = rows()[index]
    if (!row) return
    setFocusedID(row.agent.id)
    if (virtualized()) {
      const { offsets, sizes } = layout()
      const top = offsets[index] ?? 0
      const bottom = top + (sizes[index] ?? ROW_HEIGHT)
      const current = scrollTop()
      const next =
        top < current ? top : bottom > current + viewport() ? Math.max(0, bottom - viewport()) : current
      if (next !== current) {
        setScrollTop(next)
        if (scroller) scroller.scrollTop = next
      }
    }
    setPendingFocus(row.agent.id)
  }

  const refocus = (sessionID: string) => {
    setFocusedID(sessionID)
    setPendingFocus(sessionID)
  }

  const onKeyDown = (event: KeyboardEvent, row: ExecutionAgentRow) => {
    if (event.target !== event.currentTarget) return
    const list = rows()
    const index = list.findIndex((candidate) => candidate.agent.id === row.agent.id)
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusRow(Math.min(list.length - 1, index + 1))
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      focusRow(Math.max(0, index - 1))
      return
    }
    if (event.key === "Home") {
      event.preventDefault()
      focusRow(0)
      return
    }
    if (event.key === "End") {
      event.preventDefault()
      focusRow(list.length - 1)
      return
    }
    if (event.key === "ArrowRight") {
      event.preventDefault()
      if (row.hasChildren && !row.expanded) {
        props.model.toggleAgentExpanded(row.agent.id)
        refocus(row.agent.id)
        return
      }
      if (row.hasChildren && row.expanded) focusRow(index + 1)
      return
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      if (row.hasChildren && row.expanded) {
        props.model.toggleAgentExpanded(row.agent.id)
        refocus(row.agent.id)
        return
      }
      const parent = row.parentID ? list.findIndex((candidate) => candidate.agent.id === row.parentID) : -1
      if (parent >= 0) focusRow(parent)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      if (row.hasChildren) {
        props.model.toggleAgentExpanded(row.agent.id)
        refocus(row.agent.id)
        return
      }
      props.model.openSession(row.agent.id)
    }
  }

  return (
    <div class="execution-agents" data-testid="execution-agents">
      <PartialTreeBanner model={props.model} />
      <div
        ref={scroller}
        class="execution-agents__scroller"
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop)
          if (event.currentTarget.clientHeight) setViewport(event.currentTarget.clientHeight)
        }}
      >
        <ul
          role="tree"
          aria-label={language.t("execution.agents.tree.label")}
          class="execution-agents__tree"
          style={{
            "padding-top": `${paddingTop()}px`,
            "padding-bottom": `${paddingBottom()}px`,
          }}
        >
          <For each={visible()}>
            {(row, index) => (
              <AgentRow
                row={row}
                model={props.model}
                focused={focusedID() === row.agent.id || (focusedID() === undefined && index() === 0)}
                onFocus={() => setFocusedID(row.agent.id)}
                onKeyDown={(event) => onKeyDown(event, row)}
                register={(element) => register(row.agent.id, element)}
              />
            )}
          </For>
        </ul>
      </div>
    </div>
  )
}

function rowAt(offsets: number[], position: number) {
  let low = 0
  let high = offsets.length - 1
  let result = 0
  while (low <= high) {
    const mid = (low + high) >> 1
    if ((offsets[mid] ?? 0) <= position) {
      result = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return result
}

function PartialTreeBanner(props: { model: ExecutionModel }) {
  const language = useLanguage()
  const tree = () => props.model.agentTree()
  return (
    <Show when={!tree().complete && tree().nodes.length > 0}>
      <div class="execution-agents__partial" role="status" data-testid="execution-agents-partial">
        <Icon name="outline-hexagonal-warning" size="small" />
        <span>{language.t("execution.agents.partial")}</span>
        <Show when={tree().missingParentID}>
          {(id) => <span>{language.t("execution.agents.partialMissing", { id: id() })}</span>}
        </Show>
      </div>
    </Show>
  )
}

function AgentRow(props: {
  row: ExecutionAgentRow
  model: ExecutionModel
  focused: boolean
  onFocus: () => void
  onKeyDown: (event: KeyboardEvent) => void
  register: (element: HTMLElement) => void
}) {
  const language = useLanguage()
  const agent = () => props.row.agent
  const active = () => agent().assignments?.filter((assignment) => assignment.active) ?? []
  const history = () => agent().assignments?.filter((assignment) => !assignment.active) ?? []
  const title = () => agent().title || agent().id
  const role = () => active()[0]?.role

  return (
    <li
      id={`execution-agent-${agent().id}`}
      ref={props.register}
      role="treeitem"
      data-agent-id={agent().id}
      aria-level={props.row.level}
      aria-posinset={props.row.position}
      aria-setsize={props.row.setSize}
      aria-expanded={props.row.hasChildren ? props.row.expanded : undefined}
      aria-label={language.t("execution.agent.row.label", {
        title: title(),
        state: language.t(stateKey(agent().state)),
      })}
      tabindex={props.focused ? 0 : -1}
      class="execution-agent"
      classList={{ "execution-agent--error": agent().state === "error" }}
      onFocus={props.onFocus}
      onKeyDown={props.onKeyDown}
    >
      <div class="execution-agent__main">
        <Show when={props.row.hasChildren}>
          <button
            type="button"
            class="execution-agent__toggle"
            aria-label={
              props.row.expanded
                ? language.t("execution.agent.collapse", { title: title() })
                : language.t("execution.agent.expand", { title: title() })
            }
            onClick={() => props.model.toggleAgentExpanded(agent().id)}
          >
            <Icon name={props.row.expanded ? "chevron-down" : "chevron-right"} size="small" />
          </button>
        </Show>
        <span class="execution-agent__state">
          <Icon name={STATE_ICONS[agent().state]} size="small" />
          <span>{language.t(stateKey(agent().state))}</span>
        </span>
        <span class="execution-agent__title">{title()}</span>
        <Show when={props.row.controller}>
          <span class="execution-agent__badge">{language.t("execution.agent.controller")}</span>
        </Show>
        <Show when={role()}>{(value) => <span class="execution-agent__role">{language.t(roleKey(value()))}</span>}</Show>
        <span class="execution-agent__model">
          <Show when={agent().model} fallback={<span>{language.t("execution.agent.model.unknown")}</span>}>
            <span>{agent().model?.providerID}/{agent().model?.id}</span>
          </Show>
        </span>
        <Show when={agent().usage}>{(usage) => <AgentUsage usage={usage()} />}</Show>
        <Show when={agent().activity}>
          <span class="execution-agent__activity">{agent().activity}</span>
        </Show>
        <button
          type="button"
          class="execution-agent__open"
          aria-label={language.t("execution.agent.open", { title: title() })}
          onClick={() => props.model.openSession(agent().id)}
        >
          <Icon name="arrow-up-right" size="small" />
        </button>
      </div>
      <Show when={agent().error}>
        <div class="execution-agent__error">
          <span class="execution-agent__error-message">{agent().error}</span>
          <button
            type="button"
            class="execution-agent__retry"
            aria-label={language.t("execution.agent.retry", { title: title() })}
            onClick={() => props.model.retryAgent(agent().id)}
          >
            {language.t("execution.agent.retry.action")}
          </button>
        </div>
      </Show>
      <Show when={active().length > 0 || history().length > 0}>
        <div class="execution-agent__assignments">
          <Show when={active().length > 0}>
            <ul
              class="execution-agent__assignments-current"
              aria-label={language.t("execution.agent.assignments.current")}
            >
              <For each={active()}>
                {(assignment) => (
                  <li class="execution-agent__assignment">
                    <span>{assignment.taskTitle ?? assignment.taskID}</span>
                    <span class="execution-agent__assignment-role">{language.t(roleKey(assignment.role))}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={history().length > 0}>
            <button
              type="button"
              class="execution-agent__history-toggle"
              aria-expanded={props.model.isAssignmentHistoryExpanded(agent().id)}
              onClick={() => props.model.toggleAssignmentHistory(agent().id)}
            >
              {props.model.isAssignmentHistoryExpanded(agent().id)
                ? language.t("execution.agent.assignments.hide")
                : language.plural("execution.agent.assignments.show", history().length)}
            </button>
            <Show when={props.model.isAssignmentHistoryExpanded(agent().id)}>
              <ul
                class="execution-agent__assignments-history"
                aria-label={language.t("execution.agent.assignments.previous")}
              >
                <For each={history()}>
                  {(assignment) => (
                    <li class="execution-agent__assignment">
                      <span>{assignment.taskTitle ?? assignment.taskID}</span>
                      <span class="execution-agent__assignment-role">{language.t(roleKey(assignment.role))}</span>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </div>
      </Show>
    </li>
  )
}

function AgentUsage(props: { usage: NativeUsage }) {
  const language = useLanguage()
  const text = () => {
    const cost =
      props.usage.cost === undefined
        ? undefined
        : new Intl.NumberFormat(language.intl(), { style: "currency", currency: "USD" }).format(props.usage.cost)
    const total = props.usage.tokens === undefined ? undefined : tokenTotal(props.usage.tokens)
    const tokens = total === undefined ? undefined : total.toLocaleString(language.intl())
    if (cost !== undefined && tokens !== undefined && total !== undefined)
      return language.plural("execution.agent.usage.both", total, { cost, tokens })
    if (cost !== undefined) return language.t("execution.agent.usage.costOnly", { cost })
    if (tokens !== undefined && total !== undefined)
      return language.plural("execution.agent.usage.tokensOnly", total, { tokens })
    return undefined
  }
  return (
    <Show when={text()}>
      {(value) => (
        <span class="execution-agent__usage" data-testid="execution-agent-usage">
          {value()}
        </span>
      )}
    </Show>
  )
}

function stateKey(state: ExecutionAgentState) {
  if (state === "running") return "execution.agent.state.running" as const
  if (state === "idle") return "execution.agent.state.idle" as const
  if (state === "needs_input") return "execution.agent.state.needs_input" as const
  if (state === "error") return "execution.agent.state.error" as const
  return "execution.agent.state.unknown" as const
}

function roleKey(role: ExecutionAgentRole) {
  if (role === "controller") return "execution.agent.role.controller" as const
  if (role === "implementer") return "execution.agent.role.implementer" as const
  if (role === "spec_reviewer") return "execution.agent.role.spec_reviewer" as const
  if (role === "code_reviewer") return "execution.agent.role.code_reviewer" as const
  return "execution.agent.role.debugger" as const
}
