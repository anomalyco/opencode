import { createEffect, For, Match, on, onCleanup, Show, Switch, type JSX } from "solid-js"
import { animate, type AnimationPlaybackControls } from "motion"
import { useI18n } from "../context/i18n"
import { createStore } from "solid-js/store"
import { Collapsible } from "./collapsible"
import { Icon, type IconProps } from "./icon"
import { Spinner } from "./spinner"
import { TextShimmer } from "./text-shimmer"
import { suppressAutoScrollResize } from "../hooks/create-auto-scroll"
import { normalizeTool } from "./tool-meta"

export type TriggerTitle = {
  title: string
  titleClass?: string
  subtitle?: string
  subtitleClass?: string
  args?: string[]
  argsClass?: string
  action?: JSX.Element
}

const isTriggerTitle = (val: any): val is TriggerTitle => {
  return (
    typeof val === "object" && val !== null && "title" in val && (typeof Node === "undefined" || !(val instanceof Node))
  )
}

export interface BasicToolProps {
  icon: IconProps["name"]
  trigger: TriggerTitle | JSX.Element
  children?: JSX.Element
  status?: string
  showPendingMeta?: boolean
  showPendingDetails?: boolean
  hideDetails?: boolean
  defaultOpen?: boolean
  forceOpen?: boolean
  defer?: boolean
  mountDetails?: "open" | "always"
  locked?: boolean
  animated?: boolean
  onSubtitleClick?: () => void
}

const SPRING = { type: "spring" as const, visualDuration: 0.35, bounce: 0 }

export function BasicTool(props: BasicToolProps) {
  const [state, setState] = createStore({
    open: props.defaultOpen ?? false,
    ready: props.defaultOpen ?? false,
  })
  const open = () => state.open
  const ready = () => state.ready
  const pending = () => props.status === "pending" || props.status === "running"
  const meta = () => !pending() || !!props.showPendingMeta
  const details = () => !pending() || !!props.showPendingDetails
  const hasDetails = () => !!props.children && !props.hideDetails && details()
  const mountDetails = () => hasDetails() && (props.mountDetails === "always" || open() || !!props.forceOpen)

  let frame: number | undefined

  const cancel = () => {
    if (frame === undefined) return
    cancelAnimationFrame(frame)
    frame = undefined
  }

  onCleanup(cancel)

  createEffect(() => {
    if (props.forceOpen) setState("open", true)
  })

  createEffect(
    on(
      () => props.defaultOpen,
      (value) => {
        if (value === undefined) return
        setState("open", value)
        setState("ready", value)
      },
      { defer: true },
    ),
  )

  createEffect(
    on(
      open,
      (value) => {
        if (!props.defer) return
        if (!value) {
          cancel()
          setState("ready", false)
          return
        }

        cancel()
        frame = requestAnimationFrame(() => {
          frame = undefined
          if (!open()) return
          setState("ready", true)
        })
      },
      { defer: true },
    ),
  )

  // Animated height for collapsible open/close
  let contentRef: HTMLDivElement | undefined
  let heightAnim: AnimationPlaybackControls | undefined
  const initialOpen = open()

  createEffect(
    on(
      open,
      (isOpen) => {
        if (!props.animated || !contentRef) return
        heightAnim?.stop()
        if (isOpen) {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "auto" }, SPRING)
          heightAnim.finished.then(() => {
            if (!contentRef || !open()) return
            contentRef.style.overflow = "visible"
            contentRef.style.height = "auto"
          })
        } else {
          contentRef.style.overflow = "hidden"
          heightAnim = animate(contentRef, { height: "0px" }, SPRING)
        }
      },
      { defer: true },
    ),
  )

  onCleanup(() => {
    heightAnim?.stop()
  })

  const handleOpenChange = (value: boolean) => {
    if (pending() && !props.showPendingDetails) return
    if (props.locked && !value) return
    suppressAutoScrollResize()
    setState("open", value)
  }

  return (
    <Collapsible open={open()} onOpenChange={handleOpenChange} class="tool-collapsible" data-detail-mounted={mountDetails() ? "true" : undefined}>
      <Collapsible.Trigger>
        <div data-component="tool-trigger">
          <div data-slot="basic-tool-tool-trigger-content">
            <div data-slot="basic-tool-tool-indicator">
              <Show when={pending()} fallback={<Icon name={props.icon} size="small" />}>
                <Spinner />
              </Show>
            </div>
            <div data-slot="basic-tool-tool-info">
              <Switch>
                <Match when={isTriggerTitle(props.trigger) && props.trigger}>
                  {(trigger) => (
                    <div data-slot="basic-tool-tool-info-structured">
                      <div data-slot="basic-tool-tool-info-main">
                        <span
                          data-slot="basic-tool-tool-title"
                          classList={{
                            [trigger().titleClass ?? ""]: !!trigger().titleClass,
                          }}
                        >
                          <TextShimmer text={trigger().title} active={pending()} />
                        </span>
                        <Show when={meta()}>
                          <Show when={trigger().subtitle}>
                            <span
                              data-slot="basic-tool-tool-subtitle"
                              classList={{
                                [trigger().subtitleClass ?? ""]: !!trigger().subtitleClass,
                                clickable: !!props.onSubtitleClick,
                              }}
                              onClick={(e) => {
                                if (props.onSubtitleClick) {
                                  e.stopPropagation()
                                  props.onSubtitleClick()
                                }
                              }}
                            >
                              {trigger().subtitle}
                            </span>
                          </Show>
                          <Show when={trigger().args?.length}>
                            <For each={trigger().args}>
                              {(arg) => (
                                <span
                                  data-slot="basic-tool-tool-arg"
                                  classList={{
                                    [trigger().argsClass ?? ""]: !!trigger().argsClass,
                                  }}
                                >
                                  {arg}
                                </span>
                              )}
                            </For>
                          </Show>
                        </Show>
                      </div>
                      <Show when={!pending() && trigger().action}>
                        <span data-slot="basic-tool-tool-action">{trigger().action}</span>
                      </Show>
                    </div>
                  )}
                </Match>
                <Match when={true}>{props.trigger as JSX.Element}</Match>
              </Switch>
            </div>
          </div>
          <Show when={hasDetails() && !props.locked}>
            <Collapsible.Arrow />
          </Show>
        </div>
      </Collapsible.Trigger>
      <Show when={props.animated && mountDetails()}>
        <div
          ref={contentRef}
          data-slot="collapsible-content"
          data-animated
          style={{
            height: initialOpen ? "auto" : "0px",
            overflow: initialOpen ? "visible" : "hidden",
          }}
        >
          {props.children}
        </div>
      </Show>
      <Show when={!props.animated && mountDetails()}>
        <Collapsible.Content>
          <Show when={!props.defer || ready()}>{props.children}</Show>
        </Collapsible.Content>
      </Show>
    </Collapsible>
  )
}

export function glyph(tool: string): IconProps["name"] {
  const name = normalizeTool(tool)
  if (name.includes("read")) return "glasses"
  if (name.includes("search") || name.includes("grep") || name.includes("glob") || name.includes("find"))
    return "magnifying-glass-menu"
  if (name.includes("write") || name.includes("patch") || name.includes("edit")) return "code-lines"
  if (
    name === "bash" ||
    name.includes("terminal") ||
    name.includes("shell") ||
    name.includes("command") ||
    name.includes("exec") ||
    name === "process"
  )
    return "console"
  if (name.includes("web") || name.includes("browser") || name.includes("navigate") || name.includes("crawl"))
    return "window-cursor"
  if (name.includes("task") || name.includes("agent") || name.includes("delegate")) return "task"
  if (name.includes("todo")) return "checklist"
  if (name.includes("question")) return "bubble-5"
  return "mcp"
}

export function label(input: Record<string, unknown> | undefined) {
  const keys = ["description", "query", "url", "command", "cmd", "pattern", "filePath", "path", "name", "goal"]
  const hit = keys
    .map((key) => input?.[key])
    .find((value): value is string => typeof value === "string" && value.length > 0)
  if (hit) return hit
  const urls = input?.urls
  if (!Array.isArray(urls)) return
  return urls.find((value): value is string => typeof value === "string" && value.length > 0)
}

function clip(value: string, size = 48) {
  if (value.length <= size) return value
  return `${value.slice(0, size - 3)}...`
}

export function args(input: Record<string, unknown> | undefined) {
  if (!input) return []
  const skip = new Set([
    "description",
    "query",
    "url",
    "urls",
    "filePath",
    "path",
    "pattern",
    "name",
    "command",
    "cmd",
    "goal",
    "content",
    "patch",
    "diff",
    "oldString",
    "newString",
    "old_string",
    "new_string",
  ])
  return Object.entries(input)
    .filter(([key]) => !skip.has(key))
    .flatMap(([key, value]) => {
      if (typeof value === "string") return [`${key}=${clip(value)}`]
      if (typeof value === "number") return [`${key}=${value}`]
      if (typeof value === "boolean") return [`${key}=${value}`]
      return []
    })
    .slice(0, 3)
}

export function GenericTool(props: {
  tool: string
  status?: string
  hideDetails?: boolean
  input?: Record<string, unknown>
  output?: string
}) {
  const i18n = useI18n()

  const inputJson = () => {
    const v = props.input
    if (!v || typeof v !== "object") return ""
    const keys = Object.keys(v)
    if (keys.length === 0) return ""
    // single "input" raw fallback (set by parseGenericAgentCompactArgs when args
    // couldn't be parsed as JSON) – show the raw string directly, not as JSON
    if (keys.length === 1 && keys[0] === "input" && typeof (v as any).input === "string") {
      return (v as any).input as string
    }
    try {
      return JSON.stringify(v, null, 2)
    } catch {
      return String(v)
    }
  }

  const hasInput = () => inputJson().length > 0
  const hasOutput = () => typeof props.output === "string" && props.output.length > 0
  const hasBody = () => hasInput() || hasOutput()

  return (
    <BasicTool
      icon={glyph(props.tool)}
      showPendingMeta
      status={props.status}
      trigger={{
        title: i18n.t("ui.basicTool.called", { tool: props.tool }),
        subtitle: label(props.input),
        args: args(props.input),
      }}
      hideDetails={props.hideDetails || !hasBody()}
    >
      <Show when={hasInput()}>
        <div data-component="tool-input" data-scrollable>
          <pre>
            <code>{inputJson()}</code>
          </pre>
        </div>
      </Show>
      <Show when={hasOutput()}>
        <div data-component="tool-output" data-scrollable>
          <pre>
            <code>{props.output}</code>
          </pre>
        </div>
      </Show>
    </BasicTool>
  )
}
