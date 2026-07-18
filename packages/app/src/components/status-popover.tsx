import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Icon as IconV2 } from "@opencode-ai/ui/v2/icon"
import { Popover } from "@opencode-ai/ui/popover"
import { Suspense, createMemo, createSignal, lazy, Show, type JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { ServerConnection, useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useSync } from "@/context/sync"
import { useGlobal } from "@/context/global"
import { hasNonBlockingServiceIssue, serverStatusDotClass } from "./status-popover-indicator"

const Body = lazy(() => import("./status-popover-body").then((x) => ({ default: x.StatusPopoverBody })))
const ServerBody = lazy(() => import("./status-popover-body").then((x) => ({ default: x.StatusPopoverServerBody })))

export function StatusPopover() {
  const language = useLanguage()
  const server = useServer()
  const global = useGlobal()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  const serverHealth = () => global.servers.health[server.key]?.healthy
  const ready = createMemo(() => serverHealth() === false || (sync().data.mcp_ready && sync().data.lsp_ready))
  const issue = createMemo(() =>
    hasNonBlockingServiceIssue({
      mcp: Object.values(sync().data.mcp ?? {}).map((item) => item.status),
      lsp: (sync().data.lsp ?? []).map((item) => item.status),
    }),
  )

  return (
    <Popover
      open={shown()}
      onOpenChange={setShown}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class: "titlebar-icon w-8 h-6 p-0 box-border",
        "aria-label": language.t("status.popover.trigger"),
        style: { scale: 1 },
      }}
      trigger={
        <div class="relative size-4">
          <div class="badge-mask-tight size-4 flex items-center justify-center">
            <Icon name={shown() ? "status-active" : "status"} size="small" />
          </div>
          <div
            class={`absolute -top-px -right-px size-1.5 rounded-full ${serverStatusDotClass({
              ready: ready(),
              serverHealth: serverHealth(),
              issue: issue(),
            })}`}
          />
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-end"
      shift={-168}
    >
      <Show when={shown()}>
        <Suspense
          fallback={
            <div class="w-[360px] h-14 rounded-xl bg-background-strong shadow-[var(--shadow-lg-border-base)]" />
          }
        >
          <Body shown={shown} />
        </Suspense>
      </Show>
    </Popover>
  )
}

export function StatusPopoverV2(props: { scope?: "server" }) {
  if (props.scope === "server") return <ServerStatusPopover />
  return <DirectoryStatusPopover />
}

function DirectoryStatusPopover() {
  const language = useLanguage()
  const server = useServerSDK()
  const global = useGlobal()
  const sync = useSync()
  const [shown, setShown] = createSignal(false)
  const serverHealth = () => global.servers.health[ServerConnection.key(server().server)]?.healthy
  const ready = createMemo(() => serverHealth() === false || (sync().data.mcp_ready && sync().data.lsp_ready))
  const issue = createMemo(() =>
    hasNonBlockingServiceIssue({
      mcp: Object.values(sync().data.mcp ?? {}).map((item) => item.status),
      lsp: (sync().data.lsp ?? []).map((item) => item.status),
    }),
  )
  const state = createMemo<StatusPopoverState>(() => ({
    shown: shown(),
    ready: ready(),
    serverHealth: serverHealth(),
    issue: issue(),
    label: language.t("status.popover.trigger"),
    onOpenChange: setShown,
    body: () => (
      <StatusPopoverBody shown={shown()}>
        <Body shown={shown} />
      </StatusPopoverBody>
    ),
  }))

  return <StatusPopoverView state={state()} />
}

function ServerStatusPopover() {
  const language = useLanguage()
  const server = useServer()
  const global = useGlobal()
  const [shown, setShown] = createSignal(false)
  const serverHealth = () => global.servers.health[server.key]?.healthy
  const state = createMemo<StatusPopoverState>(() => ({
    shown: shown(),
    ready: serverHealth() !== undefined,
    serverHealth: serverHealth(),
    issue: false,
    label: language.t("status.popover.trigger"),
    onOpenChange: setShown,
    body: () => (
      <StatusPopoverBody shown={shown()}>
        <ServerBody />
      </StatusPopoverBody>
    ),
  }))

  return <StatusPopoverView state={state()} />
}

type StatusPopoverState = {
  shown: boolean
  ready: boolean
  serverHealth: boolean | undefined
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
      triggerAs={IconButtonV2}
      triggerProps={{
        variant: "ghost-muted",
        size: "large",
        class: "!w-9 shrink-0",
        state: props.state.shown ? "pressed" : undefined,
        "aria-label": props.state.label,
      }}
      trigger={
        <div class="relative size-4">
          <IconV2 name={props.state.shown ? "status-active" : "status"} />
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
