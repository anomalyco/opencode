import { ErrorBoundary, Show, Match, Switch, createMemo, createEffect, createComputed, on } from "solid-js"
import { createStore } from "solid-js/store"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { NewSessionView } from "@/session/composer/session-new-view"
import { SessionHeader } from "@/session/header/session-header"
import { useLayout } from "@/context/layout"
import { useServerSDK } from "@/context/server-sdk"
import { useSettings } from "@/context/settings"
import { MessageTimeline } from "@/session/timeline/message-timeline"
import type { SessionModel } from "@/session/model"
import { SESSION_PANEL_WIDTH_MIN } from "@/session/session-panel-width"
import { SessionPanelFrame, SessionRouteFrame } from "@/session/session-frame"
import { TerminalPanel } from "@/session/terminal/panel"
import { useUsageExceededDialogs } from "./usage-exceeded-dialogs"
import { SessionErrorFallback } from "./route-error"
import { createSessionScreenLayout } from "./screen-layout"
import { createSessionReview } from "./review/model"
import { SessionDesktopReview, SessionMobileReview, SessionMobileTabs } from "./review/view"
import { createSessionTimelineInteraction } from "./timeline/interaction"
import { ActiveSessionComposer, createActiveSessionComposer } from "./composer/active-session"

export function SessionScreen(props: { session: SessionModel }) {
  const session = props.session
  const layout = useLayout()
  const serverSDK = useServerSDK()
  const settings = useSettings()
  const isDesktop = session.isDesktop
  const screen = createSessionScreenLayout(session, serverSDK.scope)
  const timeline = createSessionTimelineInteraction(session)
  const messagesReady = timeline.ready
  const [store, setStore] = createStore({ deferRender: false })

  createComputed((prev) => {
    const key = session.identity.sessionKey()
    if (key !== prev) {
      setStore("deferRender", true)
      const owner = session.ownership.capture()
      requestAnimationFrame(() => {
        setTimeout(() => owner.run(() => setStore("deferRender", false)), 0)
      })
    }
    return key
  })
  const review = createSessionReview({ session, screen, deferRender: () => store.deferRender })
  const composer = createActiveSessionComposer({
    session,
    screen,
    timeline,
    deferRender: () => store.deferRender,
  })

  useUsageExceededDialogs()

  const mobileTabsBottom = createMemo(() => !isDesktop() && settings.general.mobileTitlebarPosition() === "bottom")

  const sessionErrorFallback = (error: unknown, reset: () => void) => {
    createEffect(on(session.identity.sessionKey, reset, { defer: true }))
    return <SessionErrorFallback error={error} sessionID={session.identity.params.id} />
  }

  const sessionPanelContent = () => (
    <>
      {timeline.resource() ?? ""}
      <Show when={!isDesktop() && !!session.identity.params.id && !mobileTabsBottom()}>
        <SessionMobileTabs review={review} compact />
      </Show>
      <div class="flex-1 min-h-0 overflow-hidden">
        <Switch>
          <Match when={session.identity.params.id && review.mobile.changes()}>
            <SessionMobileReview review={review} />
          </Match>
          <Match when={session.identity.params.id}>
            <Show when={messagesReady() ? session.identity.params.id : undefined} keyed>
              {(_id) => (
                <MessageTimeline
                  session={session}
                  actions={composer.actions.timeline}
                  scroll={timeline.scroll}
                  onResumeScroll={timeline.actions.resume}
                  setScrollRef={timeline.view.setScrollRef}
                  onScheduleScrollState={timeline.view.scheduleScrollState}
                  onAutoScrollHandleScroll={timeline.autoScroll.handleScroll}
                  onMarkScrollGesture={timeline.view.markGesture}
                  hasScrollGesture={timeline.view.hasGesture()}
                  onUserScroll={timeline.view.markUserScroll}
                  onHistoryScroll={timeline.view.onHistoryScroll}
                  onAutoScrollInteraction={timeline.autoScroll.handleInteraction}
                  shouldAnchorBottom={timeline.view.shouldAnchorBottom()}
                  centered={screen.centered()}
                  setContentRef={timeline.view.setContentRef}
                  userMessages={timeline.userMessages()}
                  diffs={review.details.diffs}
                  onReview={review.open}
                  workspaceMoveEligible={composer.workspaceMoveEligible()}
                  onSummaryOpenChange={review.details.setOpen}
                  setHistoryAnchor={timeline.view.setHistoryAnchor}
                  anchor={timeline.view.anchor}
                  setRevealMessage={timeline.view.setRevealMessage}
                  setScrollToEnd={timeline.view.setScrollToEnd}
                />
              )}
            </Show>
          </Match>
          <Match when={true}>
            <NewSessionView worktree={composer.newSessionWorktree()} />
          </Match>
        </Switch>
      </div>

      <Show when={session.identity.params.id && !review.mobile.changes()}>
        <ActiveSessionComposer
          model={composer}
          session={session}
          accentSubmit={session.workspace.current()}
          onResponseSubmit={timeline.actions.resume}
        />
      </Show>
      <Show when={!!session.identity.params.id && mobileTabsBottom()}>
        <SessionMobileTabs review={review} compact bottom />
      </Show>
    </>
  )

  return (
    <SessionRouteFrame>
      <SessionHeader />
      <div ref={screen.panel.ref} class="flex-1 min-h-0 flex flex-col md:flex-row gap-2 p-2">
        <div
          classList={{
            "@container relative shrink-0 flex flex-col min-h-0 h-full flex-1 md:flex-none transition-[width]": true,
            "duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
              !screen.size.active() && !screen.review.snap() && !screen.terminal.inlineOnlyOpen(),
          }}
          style={{
            width: screen.panel.width(),
          }}
        >
          <Show when={screen.panel.key()} keyed>
            {(_) => (
              <SessionPanelFrame raised={!!session.identity.params.id}>
                <ErrorBoundary fallback={sessionErrorFallback}>{sessionPanelContent()}</ErrorBoundary>
              </SessionPanelFrame>
            )}
          </Show>

          <Show when={screen.panel.resizable()}>
            <div onPointerDown={() => screen.size.start()}>
              <ResizeHandle
                class="-end-1"
                direction="horizontal"
                size={screen.panel.resizedWidth()}
                min={SESSION_PANEL_WIDTH_MIN}
                max={screen.panel.max()}
                onResize={(width) => {
                  screen.size.touch()
                  layout.session.resize(width)
                }}
              />
            </div>
          </Show>
        </div>

        <Show when={isDesktop() ? screen.side.layout().visible : screen.terminal.open()}>
          <div class="min-w-0 h-full flex flex-1 flex-col">
            <Show when={isDesktop() && (screen.review.panelOpen() || screen.files.open())}>
              <div class="min-h-0 flex-1">
                <SessionDesktopReview review={review} />
              </div>
            </Show>
            <Show when={screen.side.layout().stacked}>
              <div class="relative h-2 shrink-0" onPointerDown={() => screen.size.start()}>
                <ResizeHandle
                  class="!relative !inset-auto !h-full !w-full !transform-none"
                  direction="vertical"
                  size={layout.terminal.height()}
                  min={100}
                  max={typeof window === "undefined" ? 600 : window.innerHeight * 0.6}
                  collapseThreshold={50}
                  onResize={(height) => {
                    screen.size.touch()
                    layout.terminal.resize(height)
                  }}
                  onCollapse={() => session.layout.view().terminal.close()}
                />
              </div>
            </Show>
            <Show when={screen.terminal.open()}>
              <div
                classList={{
                  "min-h-0 shrink-0": screen.side.layout().stacked,
                  "min-h-0 flex-1": !screen.side.layout().stacked,
                }}
              >
                <TerminalPanel stacked={screen.side.layout().stacked} />
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </SessionRouteFrame>
  )
}
