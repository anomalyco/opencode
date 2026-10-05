// The connected panel: header, a new conversation or an open session, and the routing between them.
import type { SessionInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Logo } from "@opencode/ui/logo"
import { Tooltip } from "@opencode/ui/tooltip"
import { Match, Show, Suspense, Switch, createMemo, createSignal, lazy, onCleanup, onMount } from "solid-js"
import type { SiteScript } from "../shared/site-script"
import { BrowserControlHandoffDock, BrowserControlMenu, BrowserControlNotice } from "./browser-control"
import { BrowsingAccessDock } from "./browsing-access"
import { TabRequestDock } from "./tab-request"
import { Composer, prefillDraft } from "./composer"
import { useServer } from "./connection"
import { toastError } from "./format"
import { History, SessionPicker } from "./history"
import { ProjectPicker } from "./projects"
import { ScriptApprovalDock, SiteScriptsView, scriptsOnPage } from "./site-scripts"

const SessionView = lazy(() => import("./session"))

export function Shell() {
  const server = useServer()
  const data = server.data
  const [view, setView] = createSignal<string>()
  // The site scripts list replaces the conversation until the user goes back or opens another one.
  const [managing, setManaging] = createSignal(false)
  // A directory picked for this panel's lifetime; every fresh panel starts in the server's home directory.
  const [picked, setPicked] = createSignal<string>()
  const home = () => data.location.info()?.directory
  const directory = () => picked() ?? home()
  const session = createMemo(() => {
    const id = view()
    return id ? data.session.get(id) : undefined
  })
  const composer = { current: undefined as HTMLTextAreaElement | undefined }
  // Matches the toolbar badge: enabled scripts that run on the active tab.
  const running = createMemo(() => scriptsOnPage(server.background).filter((script) => script.enabled).length)

  const focusComposer = () => requestAnimationFrame(() => composer.current?.focus())

  // The session chunk is heavy (timeline, markdown, diffs); compile it while the new conversation idles.
  onMount(() => {
    focusComposer()
    const idle = requestIdleCallback(() => void SessionView.preload())
    onCleanup(() => cancelIdleCallback(idle))
  })

  // Tell the background which session this panel shows, so the agent's browser follows the panel.
  const announce = (info: SessionInfo) => {
    if (view() !== info.id) return
    server.background.show({ sessionID: info.id, directory: info.location.directory })
  }

  const open = (sessionID: string) => {
    setManaging(false)
    setView(sessionID)
    const info = data.session.get(sessionID)
    // A session still being created is announced once the server has it (see `create`).
    if (info && !data.session.creating(sessionID)) return announce(info)
    if (info) return
    void data.session
      .sync(sessionID)
      .then(() => {
        const loaded = data.session.get(sessionID)
        if (loaded) announce(loaded)
      })
      .catch(toastError("Couldn't open session"))
  }

  const startNew = () => {
    setManaging(false)
    setView(undefined)
    server.background.hide()
    focusComposer()
  }

  const tweak = (script: SiteScript) => {
    prefillDraft(
      { sessionID: view(), directory: directory() },
      `Change the site script "${script.name}" (id ${script.id}): `,
    )
    setManaging(false)
    focusComposer()
  }

  const create = (sessionID: string, request: Promise<SessionInfo>) => {
    open(sessionID)
    void request.then(announce).catch(() => {
      if (view() === sessionID) startNew()
    })
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base">
      <header class="flex h-11 shrink-0 items-center gap-1 border-b border-v2-border-border-muted px-2">
        <Switch
          fallback={
            <ProjectPicker
              directory={directory()}
              home={home()}
              onSelect={(value) => {
                setPicked(value)
                focusComposer()
              }}
            />
          }
        >
          <Match when={managing()}>
            <Tooltip placement="bottom" value="Back">
              <IconButton
                variant="ghost-muted"
                size="large"
                icon={<Icon name="arrow-left" />}
                aria-label="Back"
                onClick={() => {
                  setManaging(false)
                  focusComposer()
                }}
              />
            </Tooltip>
            <span class="min-w-0 flex-1 truncate px-1.5 text-[13px] font-[530] leading-4 tracking-[-0.04px] text-v2-text-text-base">
              Site scripts
            </span>
          </Match>
          <Match when={view()}>
            <Show when={session()?.parentID}>
              {(parent) => (
                <Tooltip placement="bottom" value="Back to parent session">
                  <IconButton
                    variant="ghost-muted"
                    size="large"
                    icon={<Icon name="arrow-left" />}
                    aria-label="Back to parent session"
                    onClick={() => open(parent())}
                  />
                </Tooltip>
              )}
            </Show>
            <SessionPicker title={session()?.title || "New conversation"} current={view()} onOpen={open} />
          </Match>
        </Switch>
        <BrowserControlMenu />
        <Show
          when={running() > 0}
          fallback={
            <Tooltip placement="bottom" value="Site scripts">
              <IconButton
                variant="ghost-muted"
                size="large"
                icon={<Icon name="code" />}
                aria-label="Site scripts"
                aria-pressed={managing()}
                classList={{ "bg-v2-overlay-simple-overlay-hover": managing() }}
                onClick={() => setManaging((value) => !value)}
              />
            </Tooltip>
          }
        >
          <Tooltip placement="bottom" value={`${running()} site script${running() === 1 ? "" : "s"} on this page`}>
            <Button
              variant="ghost-muted"
              size="normal"
              icon="code"
              class="shrink-0 !gap-1 !ps-1.5 !pe-2 tabular-nums"
              aria-label={`Site scripts, ${running()} on this page`}
              aria-pressed={managing()}
              classList={{ "bg-v2-overlay-simple-overlay-hover": managing() }}
              onClick={() => setManaging((value) => !value)}
            >
              {running()}
            </Button>
          </Tooltip>
        </Show>
        <Show when={!view() || managing()}>
          <History current={view()} onOpen={open} />
        </Show>
        <Tooltip placement="bottom-end" value="New conversation">
          <IconButton
            variant="ghost-muted"
            size="large"
            icon={<Icon name="new-session" />}
            aria-label="New conversation"
            onClick={startNew}
          />
        </Tooltip>
      </header>
      <ConnectionNotice />
      <BrowserControlNotice />
      <Show
        when={!managing()}
        fallback={
          <>
            <SiteScriptsView onTweak={tweak} />
            <div class="flex shrink-0 flex-col gap-1 px-2 empty:hidden [&:not(:empty)]:pb-2">
              <BrowserControlHandoffDock />
              <ScriptApprovalDock />
              <TabRequestDock />
              <BrowsingAccessDock />
            </div>
          </>
        }
      >
        <Show
          when={view()}
          keyed
          fallback={
            <>
              <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-8 pb-8 text-center">
                <div data-component="new-chat-logo" aria-hidden="true" class="text-v2-background-bg-inverse">
                  <Logo class="block aspect-[234/42] w-[136px] opacity-25" />
                </div>
                <p class="max-w-[248px] text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-faint">
                  Ask about this page, or have the agent use your tabs.
                </p>
              </div>
              <div class="flex shrink-0 flex-col gap-1 px-2 pb-2">
                <BrowserControlHandoffDock />
                <ScriptApprovalDock />
                <TabRequestDock />
                <BrowsingAccessDock />
                <Composer directory={directory()} onCreate={create} ref={(element) => (composer.current = element)} />
              </div>
            </>
          }
        >
          {(id) => (
            <Suspense>
              <SessionView sessionID={id} onOpen={open} composerRef={(element) => (composer.current = element)} />
            </Suspense>
          )}
        </Show>
      </Show>
    </div>
  )
}

function ConnectionNotice() {
  const server = useServer()
  // The first connect is quiet; only a lost or failing stream deserves a notice.
  const visible = () =>
    server.connection.status() === "reconnecting" ||
    (server.connection.status() === "connecting" && server.connection.attempt() > 1)
  return (
    <Show when={visible()}>
      <div class="flex shrink-0 items-center gap-2 border-b border-v2-border-border-muted bg-v2-state-bg-warning px-3 py-1.5 text-12-regular text-v2-state-fg-warning">
        <Icon name="warning" size="small" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate" title={server.connection.error()}>
          Reconnecting to opencode{server.connection.error() ? ` — ${server.connection.error()}` : "…"}
        </span>
        <Button variant="ghost" size="small" onClick={() => server.background.send({ type: "service.refresh" })}>
          Retry
        </Button>
      </div>
    </Show>
  )
}
