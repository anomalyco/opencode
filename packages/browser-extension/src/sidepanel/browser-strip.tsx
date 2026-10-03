// One compact row above the composer: the session's browser status, the tabs its agent can use, and
// a way to share the tab the user is looking at.
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Spinner } from "@opencode/ui/spinner"
import { Tooltip } from "@opencode/ui/tooltip"
import { For, Match, Show, Switch, createMemo } from "solid-js"
import type { PanelTab } from "../shared/protocol"
import { Favicon } from "./composer"
import { useServer } from "./connection"

export function BrowserStrip(props: { sessionID: string }) {
  const server = useServer()
  const background = server.background
  const state = () => background.browser(props.sessionID)
  const status = () => state()?.status ?? "idle"
  const tabs = () => state()?.tabs ?? []
  const shareable = createMemo(() => {
    const tab = background.state.activeTab
    if (!tab?.shareable || tab.sessionID === props.sessionID) return
    return tab
  })
  const visible = () => status() !== "idle" || tabs().length > 0 || !!shareable()

  return (
    <Show when={visible()}>
      <div data-component="browser-strip" class="flex h-8 min-w-0 items-center gap-1 px-1">
        <Switch>
          <Match when={status() === "connecting"}>
            <Tooltip placement="top" value="Connecting the browser…">
              <span class="flex h-6 shrink-0 items-center gap-1.5 px-1.5 text-12-regular text-v2-text-text-faint">
                <Spinner class="size-3.5 shrink-0 text-v2-icon-icon-muted" />
                <Show when={tabs().length === 0}>
                  <span>Connecting browser…</span>
                </Show>
              </span>
            </Tooltip>
          </Match>
          <Match when={status() === "connected"}>
            <Tooltip
              placement="top"
              value="Browser connected. The agent can use the tabs it opens and the tabs you share."
            >
              <span class="flex h-6 shrink-0 items-center gap-1.5 px-1.5 text-12-regular text-v2-text-text-faint">
                <Icon name="globe" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                <Show when={tabs().length === 0}>
                  <span>Browser ready</span>
                </Show>
              </span>
            </Tooltip>
          </Match>
          <Match when={status() === "replaced"}>
            <span class="flex min-w-0 shrink items-center gap-1.5 ps-1 text-12-regular text-v2-text-text-muted">
              <Icon name="warning" size="small" class="shrink-0 text-v2-state-fg-warning" />
              <span class="truncate">In use by another opencode client</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="small"
              class="shrink-0"
              onClick={() => background.send({ type: "browser.takeover", sessionID: props.sessionID })}
            >
              Use here
            </Button>
          </Match>
          <Match when={status() === "unsupported"}>
            <Tooltip placement="top" value={state()?.error ?? "This opencode server has no compatible browser plugin."}>
              <span class="flex min-w-0 shrink items-center gap-1.5 ps-1 text-12-regular text-v2-text-text-muted">
                <Icon name="circle-ban-sign" size="small" class="shrink-0" />
                <span class="truncate">Browser unavailable</span>
              </span>
            </Tooltip>
          </Match>
        </Switch>
        <div class="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto overscroll-x-contain no-scrollbar">
          <For each={tabs()}>{(tab) => <TabChip tab={tab} sessionID={props.sessionID} />}</For>
        </div>
        <Show when={shareable()}>
          {(tab) => (
            <Tooltip
              placement="top-end"
              value={
                tab().sessionID
                  ? `Share “${tab().title}” with this session. Another session is using it; sharing moves it here.`
                  : `Share “${tab().title}” so the agent can use it.`
              }
            >
              <Button
                type="button"
                variant="ghost-muted"
                size="small"
                class="max-w-[140px] shrink-0 ![font-weight:440]"
                onClick={() =>
                  background.send({ type: "tab.share", sessionID: props.sessionID, chromeTabID: tab().chromeTabID })
                }
              >
                <Icon name="plus-small" size="small" class="shrink-0" />
                <span class="truncate">{tab().sessionID ? "Move tab here" : "Share tab"}</span>
              </Button>
            </Tooltip>
          )}
        </Show>
      </div>
    </Show>
  )
}

function TabChip(props: { tab: PanelTab; sessionID: string }) {
  const server = useServer()
  return (
    <div
      data-component="browser-tab"
      data-active={props.tab.active}
      class="group/tab flex h-6 max-w-[160px] shrink-0 items-center rounded-md text-12-regular transition-colors duration-[120ms]"
      classList={{
        "bg-v2-background-bg-layer-02 text-v2-text-text-base": props.tab.active,
        "text-v2-text-text-muted hover:bg-v2-overlay-simple-overlay-hover": !props.tab.active,
      }}
    >
      <Tooltip
        placement="top"
        class="flex min-w-0"
        value={
          <span class="flex max-w-[280px] flex-col">
            <span class="truncate">{props.tab.title}</span>
            <span class="truncate opacity-60">{props.tab.url}</span>
            <span class="opacity-60">{props.tab.kind === "shared" ? "Shared by you" : "Opened by the agent"}</span>
          </span>
        }
      >
        <button
          type="button"
          class="flex h-6 min-w-0 items-center gap-1.5 rounded-md ps-1.5 focus-visible:outline-none"
          classList={{ "pe-1.5": props.tab.kind !== "shared", "pe-0.5": props.tab.kind === "shared" }}
          aria-label={`Show ${props.tab.title}`}
          onClick={() => server.background.send({ type: "tab.focus", sessionID: props.sessionID, tabID: props.tab.id })}
        >
          <Show when={!props.tab.loading} fallback={<Spinner class="size-3.5 shrink-0" />}>
            <Favicon url={props.tab.favIconUrl} />
          </Show>
          <span class="truncate">{props.tab.title}</span>
        </button>
      </Tooltip>
      <Show when={props.tab.kind === "shared"}>
        <button
          type="button"
          class="me-0.5 flex size-5 shrink-0 items-center justify-center rounded-[4px] text-v2-icon-icon-muted hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-icon-icon-base focus-visible:outline-none"
          aria-label={`Stop sharing ${props.tab.title}`}
          onClick={() =>
            server.background.send({ type: "tab.unshare", sessionID: props.sessionID, tabID: props.tab.id })
          }
        >
          <Icon name="close-small" size="small" />
        </button>
      </Show>
    </div>
  )
}
