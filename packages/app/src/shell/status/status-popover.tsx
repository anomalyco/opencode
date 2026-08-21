import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Popover } from "@opencode-ai/ui/popover"
import { Suspense, createMemo, createSignal, lazy, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useGlobal } from "@/runtime/server/runtime"
import { hasNonBlockingServiceIssue, hasServiceNeedingAttention, serverStatusDotClass } from "./indicator"
import { useData, useServer } from "@/runtime/server/current"
import { useWorkspaceLocation } from "@/workspaces/location"

const Body = lazy(() => import("./body").then((x) => ({ default: x.StatusPopoverBody })))

export function StatusPopover() {
  const language = useLanguage()
  const server = useServer()
  const global = useGlobal()
  const data = useData()
  const sdk = useWorkspaceLocation()
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
    placement: "bottom-end" as const,
    shift: -168,
  }

  return (
    <Popover
      open={props.state.shown}
      onOpenChange={props.state.onOpenChange}
      triggerAs={IconButton}
      triggerProps={{
        variant: "ghost-muted",
        size: "large",
        class: "!w-9 shrink-0",
        state: props.state.shown ? "pressed" : undefined,
        "aria-label": props.state.label,
      }}
      trigger={
        <div class="relative size-4">
          <Icon name={props.state.shown ? "status-active" : "status"} />
          <div
            class={`absolute -top-1 -right-1 size-2 rounded-full border border-[var(--v2-background-bg-deep)] ${serverStatusDotClass(props.state)}`}
          />
        </div>
      }
      {...popoverProps}
    >
      {props.state.body()}
    </Popover>
  )
}
