// Browser Control in the panel: a header menu while its relay is connected (the tabs its agents use, and
// letting them use the active tab), a dock when an agent hands a tab back to the user, and a notice when
// something blocks the connection. Nothing shows while Browser Control is idle.
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { PageStatus } from "../browser-control/protocol"
import { Favicon } from "./composer"
import { useServer } from "./connection"
import { RelayProblemFix, relayProblem, relayProblemTitle } from "./onboarding"

type TabInfo = { title: string; url: string; favIconUrl?: string; windowId: number }

/** Titles and icons for the relay's tabs, which the worker reports by ID only. */
function createTabInfo(ids: () => number[]) {
  const [info, setInfo] = createStore<Record<number, TabInfo>>({})
  const remember = (tab: chrome.tabs.Tab) => {
    if (tab.id === undefined) return
    setInfo(tab.id, {
      title: tab.title || tab.url || "Untitled",
      url: tab.url ?? "",
      favIconUrl: tab.favIconUrl,
      windowId: tab.windowId,
    })
  }
  createEffect(
    on(ids, (list) =>
      list.forEach((id) => {
        if (!info[id]) void chrome.tabs.get(id).then(remember, () => undefined)
      }),
    ),
  )
  const updated = (tabId: number, _change: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
    if (ids().includes(tabId)) remember(tab)
  }
  chrome.tabs.onUpdated.addListener(updated)
  onCleanup(() => chrome.tabs.onUpdated.removeListener(updated))
  return info
}

function focusTab(tabId: number, windowId?: number) {
  void chrome.tabs.update(tabId, { active: true }).catch(() => undefined)
  if (windowId !== undefined) void chrome.windows.update(windowId, { focused: true }).catch(() => undefined)
}

function stateLabel(status: PageStatus | undefined) {
  if (status?.state === "waiting") return "Your turn"
  if (status?.readOnly) return "Watching"
  if (status?.state === "running") return "Working"
  return "Ready"
}

function StateDot(props: { status: PageStatus | undefined; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={`block size-1.5 shrink-0 rounded-full ${props.class ?? ""}`}
      classList={{
        "bg-v2-state-fg-warning animate-pulse": props.status?.state === "running" && !props.status.readOnly,
        "bg-v2-state-fg-info": props.status?.state === "waiting",
        "bg-v2-icon-icon-faint":
          !props.status || props.status.state === "attached" || (props.status.state === "running" && !!props.status.readOnly),
      }}
    />
  )
}

/** Header button: shown while the relay is connected or still holds tabs. */
export function BrowserControlMenu() {
  const background = useServer().background
  const relay = () => background.state.browserControl
  const tabs = () => relay().tabs
  const info = createTabInfo(() => tabs().map((tab) => tab.tabId))
  const visible = () => relay().status === "connected" || tabs().length > 0
  const waiting = () => tabs().some((tab) => tab.status?.state === "waiting")
  const running = () => tabs().some((tab) => tab.status?.state === "running" && !tab.status.readOnly)
  const active = () => background.state.activeTab
  const attached = () => {
    const tab = active()
    return !!tab && tabs().some((item) => item.tabId === tab.chromeTabID)
  }
  const canAttach = () => relay().status === "connected" && !!active()?.shareable && !attached()
  const summary = () => {
    if (waiting()) return "Browser Control is waiting for you"
    if (running()) return "Browser Control is working"
    return "Browser Control"
  }

  return (
    <Show when={visible()}>
      <Tooltip placement="bottom" value={summary()} class="flex items-center">
        <Menu gutter={4} placement="bottom-end" modal={false}>
          <Menu.Trigger
            as={IconButton}
            variant="ghost-muted"
            size="large"
            class="relative"
            icon={
              <span class="relative flex">
                <Icon name="window-cursor" />
                <Show when={waiting() || running()}>
                  <span
                    aria-hidden="true"
                    class="absolute -top-0.5 -right-0.5 size-[7px] rounded-full ring-2 ring-v2-background-bg-base"
                    classList={{
                      "bg-v2-state-fg-info": waiting(),
                      "bg-v2-state-fg-warning": !waiting(),
                    }}
                  />
                </Show>
              </span>
            }
            aria-label={summary()}
          />
          <Menu.Portal>
            <Menu.Content class="w-[min(300px,calc(100vw-16px))]">
              <Menu.Group>
                <div class="flex items-center justify-between gap-2 pe-2.5">
                  <Menu.GroupLabel>Browser Control</Menu.GroupLabel>
                  <span class="shrink-0 text-[12px] font-[440] text-v2-text-text-faint">
                    {relay().status === "connected" ? "Connected" : "Reconnecting…"}
                  </span>
                </div>
                <Show
                  when={tabs().length > 0}
                  fallback={
                    <p class="ps-3 pe-2.5 pt-0.5 pb-2 text-[12px] font-[440] leading-[18px] text-v2-text-text-faint">
                      No tabs yet. Agents open their own tabs or use the ones you let them.
                    </p>
                  }
                >
                  <div class="-mx-0.5 max-h-[min(280px,calc(100vh-160px))] overflow-y-auto overscroll-contain px-0.5">
                    <For each={tabs()}>
                      {(tab) => (
                        <Menu.Item
                          class="!h-8 !pe-2.5"
                          onSelect={() => focusTab(tab.tabId, info[tab.tabId]?.windowId)}
                        >
                          <Favicon url={info[tab.tabId]?.favIconUrl} />
                          <span class="min-w-0 flex-1 truncate">{info[tab.tabId]?.title ?? "Tab"}</span>
                          <span class="flex shrink-0 items-center gap-1.5 text-[12px] font-[440] text-v2-text-text-faint">
                            <StateDot status={tab.status} />
                            {stateLabel(tab.status)}
                          </span>
                        </Menu.Item>
                      )}
                    </For>
                  </div>
                </Show>
              </Menu.Group>
              <Menu.Separator />
              <Menu.Item
                class="!h-8"
                disabled={!canAttach()}
                onSelect={() => {
                  const tab = active()
                  if (tab) background.send({ type: "browserControl.attach", chromeTabID: tab.chromeTabID })
                }}
              >
                <Icon name={attached() ? "check-small" : "plus-small"} size="small" class="shrink-0" />
                <span class="min-w-0 flex-1 truncate">
                  {attached() ? "Browser Control can use this tab" : "Let Browser Control use this tab"}
                </span>
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>
      </Tooltip>
    </Show>
  )
}

/** The oldest tab an agent handed back to the user (a login, 2FA, a payment), above the composer. */
export function BrowserControlHandoffDock() {
  const background = useServer().background
  const waiting = createMemo(() =>
    background.state.browserControl.tabs.filter((tab) => tab.status?.state === "waiting" && tab.status.handoffId),
  )
  const info = createTabInfo(() => waiting().map((tab) => tab.tabId))
  // By handoff, so the next one starts answerable.
  const [answered, setAnswered] = createSignal<string>()

  return (
    <Show when={waiting()[0]}>
      {(tab) => {
        const busy = () => answered() === tab().status?.handoffId
        return (
          <DockPrompt
            kind="permission"
            header={
              <div data-slot="permission-row" data-variant="header">
                <span data-slot="permission-icon">
                  <Icon name="window-cursor" size="normal" />
                </span>
                <div class="flex min-w-0 items-center justify-between gap-2">
                  <div data-slot="permission-header-title">Your turn</div>
                  <Show when={waiting().length > 1}>
                    <span class="shrink-0 text-12-regular tabular-nums text-v2-text-text-faint">
                      1 of {waiting().length}
                    </span>
                  </Show>
                </div>
              </div>
            }
            footer={
              <>
                <div />
                <div data-slot="permission-footer-actions">
                  <Button
                    variant="ghost"
                    size="normal"
                    onClick={() => focusTab(tab().tabId, info[tab().tabId]?.windowId)}
                  >
                    Show tab
                  </Button>
                  <Button
                    variant="submit"
                    size="normal"
                    disabled={busy()}
                    onClick={() => {
                      setAnswered(tab().status?.handoffId)
                      background.send({ type: "browserControl.continue", chromeTabID: tab().tabId })
                    }}
                  >
                    {busy() ? "Continuing…" : "Continue"}
                  </Button>
                </div>
              </>
            }
          >
            <div data-slot="permission-row">
              <span data-slot="permission-spacer" aria-hidden="true" />
              <div class="flex min-w-0 flex-col gap-2 pb-3">
                <p class="text-[13px] leading-5 break-words text-v2-text-text-muted">
                  {tab().status?.message || "Finish this step in the tab, then continue."}
                </p>
                <button
                  type="button"
                  class="-ms-1.5 flex h-7 min-w-0 max-w-full items-center gap-1.5 self-start rounded-md px-1.5 text-12-regular text-v2-text-text-faint transition-colors duration-[120ms] hover:bg-v2-overlay-simple-overlay-hover hover:text-v2-text-text-base"
                  onClick={() => focusTab(tab().tabId, info[tab().tabId]?.windowId)}
                >
                  <Favicon url={info[tab().tabId]?.favIconUrl} />
                  <span class="truncate">{info[tab().tabId]?.title ?? "Browser Control tab"}</span>
                </button>
              </div>
            </div>
          </DockPrompt>
        )
      }}
    </Show>
  )
}

/** A notice under the header when the relay refuses this extension or another extension holds it. */
export function BrowserControlNotice() {
  const background = useServer().background
  const problem = () => relayProblem(background.state.browserControl.status)
  const [open, setOpen] = createSignal(false)
  const [dismissed, setDismissed] = createSignal<string>()
  return (
    <Show when={problem() !== dismissed() && problem()}>
      {(value) => (
        <div class="shrink-0 border-b border-v2-border-border-muted">
          <div class="flex h-8 items-center gap-1 bg-v2-state-bg-warning ps-3 pe-1">
            <Icon name="warning" size="small" class="shrink-0 text-v2-state-fg-warning" />
            <span class="ms-1 min-w-0 flex-1 truncate text-12-medium text-v2-text-text-base">
              {relayProblemTitle(value(), true)}
            </span>
            <Button
              variant="ghost"
              size="small"
              class="shrink-0"
              aria-expanded={open()}
              onClick={() => setOpen((current) => !current)}
            >
              {open() ? "Hide" : "Fix"}
            </Button>
            <Tooltip placement="bottom-end" value="Dismiss">
              <IconButton
                variant="ghost-muted"
                size="normal"
                class="shrink-0"
                icon={<Icon name="close-small" size="small" />}
                aria-label="Dismiss"
                onClick={() => setDismissed(value())}
              />
            </Tooltip>
          </div>
          <Show when={open()}>
            <div class="border-t border-v2-border-border-muted px-3 pt-2.5 pb-3 ps-[34px]">
              <RelayProblemFix
                problem={value()}
                hideTitle
                onReconnect={() => background.send({ type: "browserControl.reconnect" })}
              />
            </div>
          </Show>
        </div>
      )}
    </Show>
  )
}
