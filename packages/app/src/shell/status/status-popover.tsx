import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Popover } from "@opencode-ai/ui/popover"
import { Suspense, createMemo, createSignal, lazy, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { hasNonBlockingServiceIssue, hasServiceNeedingAttention, serverStatusDotClass } from "./indicator"
import { useData, useServer } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useSettings } from "@/settings/model"
import { createMediaQuery } from "@solid-primitives/media"

const Body = lazy(() => import("./body").then((x) => ({ default: x.StatusPopoverBody })))

export function StatusPopover() {
  const language = useLanguage()
  const server = useServer()
  const global = useGlobal()
  const data = useData()
  const sdk = useWorkspaceLocation()
  const settings = useSettings()
  const desktop = createMediaQuery("(min-width: 768px)")
  const sidebar = () => desktop() && settings.appearance.tabLayout() === "vertical"
  const [shown, setShown] = createSignal(false)
  const serverHealth = () => global.servers.health[server.key]?.healthy
  const mcp = () => data.location.mcp.server.list({ directory: sdk().directory })
  const ready = createMemo(() => serverHealth() === false || mcp() !== undefined)
  const attention = createMemo(() =>
    hasServiceNeedingAttention({
      mcp: (mcp() ?? []).map((item) => item.status.status),
    }),
  )
  const issue = createMemo(() =>
    hasNonBlockingServiceIssue({
      mcp: (mcp() ?? []).map((item) => item.status.status),
      lsp: [],
    }),
  )
  const state = createMemo<StatusPopoverState>(() => ({
    shown: shown(),
    ready: ready(),
    serverHealth: serverHealth(),
    attention: attention(),
    issue: issue(),
    connecting: server.ctx.sdk.connection.status() !== "connected",
    sidebar: sidebar(),
    placement: sidebar() ? "top-start" : "bottom-end",
    shift: sidebar() ? 0 : -168,
    label: language.t("status.popover.trigger"),
    onOpenChange: setShown,
    body: () => (
      <StatusPopoverBody shown={shown()}>
        <Body shown={shown()} />
      </StatusPopoverBody>
    ),
  }))

  return <StatusPopoverView state={state()} />
}

type StatusPopoverState = {
  shown: boolean
  ready: boolean
  serverHealth: boolean | undefined
  attention: boolean
  issue: boolean
  connecting: boolean
  sidebar: boolean
  placement: "top-start" | "bottom-end"
  shift: number
  label: string
  onOpenChange: (value: boolean) => void
  body: () => JSX.Element
}

function StatusPopoverBody(props: { shown: boolean; children: JSX.Element }) {
  return (
    <Show when={props.shown}>
      <Suspense
        fallback={<div class="w-[360px] h-14 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]" />}
      >
        {props.children}
      </Suspense>
    </Show>
  )
}

function StatusPopoverView(props: { state: StatusPopoverState }) {
  const popoverProps = {
    class:
      "[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl",
    gutter: 4,
    placement: props.state.placement,
    shift: props.state.shift,
  }

  return (
    <Popover
      open={props.state.shown}
      onOpenChange={props.state.onOpenChange}
      triggerAs={props.state.sidebar ? "button" : IconButton}
      triggerProps={
        props.state.sidebar
          ? {
              type: "button",
              class:
                "flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[6px] px-1.5 text-[13px] leading-4 text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base data-[state=pressed]:bg-v2-background-bg-layer-02 data-[state=pressed]:text-v2-text-text-base focus-visible:outline-none focus-visible:bg-v2-background-bg-layer-02 [app-region:no-drag]",
              "data-state": props.state.shown ? "pressed" : undefined,
              "aria-label": props.state.label,
            }
          : {
              variant: "ghost-muted",
              size: "large",
              class: "!w-9 shrink-0",
              state: props.state.shown ? "pressed" : undefined,
              "aria-label": props.state.label,
            }
      }
      trigger={
        <>
          <div class="relative size-4 shrink-0">
            <Icon name={props.state.shown ? "status-active" : "status"} />
            <div
              data-slot="status-indicator"
              class={`absolute -top-1 -end-1 size-2 rounded-full border border-[var(--v2-background-bg-deep)] ${serverStatusDotClass(props.state)}`}
            />
          </div>
          <Show when={props.state.sidebar}>
            <span class="min-w-0 truncate">{props.state.label}</span>
          </Show>
        </>
      }
      {...popoverProps}
    >
      {props.state.body()}
    </Popover>
  )
}
