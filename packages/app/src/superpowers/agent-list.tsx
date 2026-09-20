import { For, Show, createMemo, createSignal, onMount } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { useLanguage } from "@/runtime/i18n/language"
import {
  AGENT_ROWS_VIRTUALIZE_THRESHOLD,
  type ExecutionAgent,
  type ExecutionAgentRole,
  type ExecutionAgentRow,
  type ExecutionAgentState,
  type ExecutionModel,
} from "./model"

const ROW_HEIGHT = 44
const OVERSCAN = 8
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
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewport, setViewport] = createSignal(FALLBACK_VIEWPORT)
  let scroller: HTMLDivElement | undefined

  const virtualized = createMemo(() => rows().length > AGENT_ROWS_VIRTUALIZE_THRESHOLD)
  const window = createMemo(() => {
    const total = rows().length
    if (!virtualized()) return { start: 0, end: total }
    const start = Math.max(0, Math.floor(scrollTop() / ROW_HEIGHT) - OVERSCAN)
    const end = Math.min(total, Math.ceil((scrollTop() + viewport()) / ROW_HEIGHT) + OVERSCAN)
    return { start, end }
  })
  const visible = createMemo(() => rows().slice(window().start, window().end))

  const focusRow = (index: number) => {
    const row = rows()[index]
    if (!row) return
    setFocusedID(row.agent.id)
    document.getElementById(`execution-agent-${row.agent.id}`)?.focus()
  }

  const refocus = (sessionID: string) => {
    setFocusedID(sessionID)
    document.getElementById(`execution-agent-${sessionID}`)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent, row: ExecutionAgentRow) => {
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

  onMount(() => {
    if (scroller?.clientHeight) setViewport(scroller.clientHeight)
  })

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
            "padding-top": `${window().start * ROW_HEIGHT}px`,
            "padding-bottom": `${(rows().length - window().end) * ROW_HEIGHT}px`,
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
              />
            )}
          </For>
        </ul>
      </div>
    </div>
  )
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
