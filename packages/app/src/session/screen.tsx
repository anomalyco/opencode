import { ErrorBoundary, Show, Match, Switch, createMemo, createEffect, createComputed, on } from "solid-js"
import { createStore } from "solid-js/store"
import createPresence from "solid-presence"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { SessionHeader } from "@/session/header/session-header"
import { useLayout } from "@/shell/state/layout"
import { useSettings } from "@/settings/model"
import { MessageTimeline } from "@/session/timeline/message-timeline"
import type { SessionModel } from "@/session/model"
import { SESSION_PANEL_WIDTH_MIN } from "@/session/session-panel-width"
import { SessionPanelFrame } from "@/session/session-frame"
import { TerminalPanel } from "@/session/terminal/panel"
import { useUsageExceededDialogs } from "./usage-exceeded-dialogs"
import { SessionErrorFallback } from "./route-error"
import { createSessionScreenLayout } from "./screen-layout"
import { createSessionReview } from "./review/model"
import { SessionDesktopReview, SessionMobileReview, SessionMobileTabs } from "./review/view"
import { createSessionTimelineInteraction } from "./timeline/interaction"
import { ActiveSessionComposerRegion, createActiveSessionRegion } from "./composer/region"
import { SessionIdentityHeader } from "./session-identity-header"

export function SessionScreen(props: { session: SessionModel }) {
  const session = props.session
  const layout = useLayout()
  const settings = useSettings()
  const isDesktop = session.isDesktop
  const screen = createSessionScreenLayout(session)
  const timeline = createSessionTimelineInteraction(session)
  const messagesReady = timeline.ready
  const [store, setStore] = createStore({
    deferRender: false,
    bottomTerminalCached: false,
    sideHeightMotion: false,
    sideRegionPresent: false,
    sideReviewPresent: false,
    sideTerminalPresent: false,
  })
  const [elements, setElements] = createStore<{
    side?: HTMLDivElement
    bottomTerminal?: HTMLDivElement
  }>({})
  const sideVisible = createMemo(() => isDesktop() && screen.side.layout().visible)
  const sideTerminalVisible = createMemo(() => isDesktop() && screen.terminal.side() && screen.terminal.open())
  const bottomTerminalVisible = createMemo(() => screen.terminal.open() && (!isDesktop() || screen.terminal.bottom()))
  const sidePresence = createPresence({
    show: sideVisible,
    element: () => elements.side ?? null,
  })
  const bottomTerminalPresence = createPresence({
    show: bottomTerminalVisible,
    element: () => elements.bottomTerminal ?? null,
  })
  createEffect(() => {
    if (sideTerminalVisible()) setStore("sideTerminalPresent", true)
    if (bottomTerminalVisible()) setStore("bottomTerminalCached", true)
    if (!sideVisible()) setStore("sideHeightMotion", false)
  })
  createEffect(() => {
    if (!isDesktop() || screen.terminal.bottom()) setStore("sideTerminalPresent", false)
    if (isDesktop() && screen.terminal.side()) setStore("bottomTerminalCached", false)
  })
  createEffect(() => {
    if (screen.side.region.open()) setStore("sideRegionPresent", true)
    if (screen.review.panelOpen()) setStore("sideReviewPresent", true)
  })

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
  const composer = createActiveSessionRegion({
    session,
    screen,
    timeline,
  })

  useUsageExceededDialogs()

  const mobileTabsBottom = createMemo(() => !isDesktop() && settings.general.mobileTitlebarPosition() === "bottom")

  const sessionErrorFallback = (error: unknown, reset: () => void) => {
    createEffect(on(session.identity.sessionKey, reset, { defer: true }))
    return <SessionErrorFallback error={error} sessionID={session.identity.params.id} />
  }

  const sessionPanelContent = () => (
    <>
      <Show when={!isDesktop() && !!session.identity.params.id && !mobileTabsBottom()}>
        <SessionMobileTabs review={review} compact />
      </Show>
      {/* Surface query errors without suspending session metadata while messages load. */}
      <Show when={timeline.resource.error}>
        {(error) => {
          throw error()
        }}
      </Show>
      <div class="flex-1 min-h-0 overflow-hidden">
        <Switch>
          <Match when={session.identity.params.id && review.mobile.changes()}>
            <SessionMobileReview review={review} />
          </Match>
          <Match when={session.identity.params.id}>
            <Show when={!messagesReady()}>
              <SessionIdentityHeader sessionID={session.identity.params.id ?? ""} session={session.data.info()} />
            </Show>
            <Show when={messagesReady() ? session.identity.params.id : undefined} keyed>
              {(_id) => (
                <MessageTimeline
                  session={session}
                  background={composer.region.state.background}
                  actions={composer.actions.timeline}
                  scroll={timeline.scroll}
                  onResumeScroll={timeline.actions.resume}
                  setScrollRef={timeline.view.setScrollRef}
                  onScheduleScrollState={timeline.view.scheduleScrollState}
                  onPin={timeline.view.pin}
                  onUnpin={timeline.view.unpin}
                  onUserScroll={timeline.view.markUserScroll}
                  onHistoryScroll={timeline.view.onHistoryScroll}
                  onSelectionInteraction={timeline.view.selectionInteraction}
                  pinned={timeline.view.pinned()}
                  centered={screen.centered()}
                  setContentRef={timeline.view.setContentRef}
                  diffs={review.details.diffs}
                  onReview={review.open}
                  workspaceMoveEligible={composer.workspaceMoveEligible()}
                  onSummaryOpenChange={review.details.setOpen}
                  anchor={timeline.view.anchor}
                  setRevealMessage={timeline.view.setRevealMessage}
                  setScrollToEnd={timeline.view.setScrollToEnd}
                />
              )}
            </Show>
          </Match>
        </Switch>
      </div>

      <Show when={!review.mobile.changes() ? session.identity.params.id : undefined} keyed>
        {(_id) => (
          <ActiveSessionComposerRegion
            model={composer}
            session={session}
            accentSubmit={session.workspace.current()}
            onResponseSubmit={timeline.actions.resume}
          />
        )}
      </Show>
      <Show when={!!session.identity.params.id && mobileTabsBottom()}>
        <SessionMobileTabs review={review} compact bottom />
      </Show>
    </>
  )

  return (
    <>
      <SessionHeader />
      <div class="flex-1 min-h-0 flex flex-col gap-2 px-2 pb-2 pt-[var(--shell-top-inset,8px)]">
        <div ref={screen.panel.ref} class="relative flex-1 min-h-0 flex flex-col md:flex-row gap-2">
          <div
            classList={{
              "@container relative z-10 shrink-0 flex flex-col min-h-0 h-full flex-1 md:flex-none transition-[width]": true,
              "duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !screen.size.active(),
            }}
            data-slot="session-chat-panel"
            style={{
              width: screen.panel.width(),
            }}
          >
            <Show when={!!session.identity.params.id}>
              <SessionPanelFrame raised>
                <ErrorBoundary fallback={sessionErrorFallback}>{sessionPanelContent()}</ErrorBoundary>
              </SessionPanelFrame>
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

          <Show when={sidePresence.present() || store.sideTerminalPresent}>
            <div
              ref={(element) => setElements("side", element)}
              data-slot="session-side-panel-presence"
              data-opened={sideVisible()}
              onAnimationEnd={(event) => {
                if (event.currentTarget !== event.target) return
                if (event.animationName !== "terminal-panel-presence-in" || !sideVisible()) return
                setStore("sideHeightMotion", true)
              }}
              classList={{
                "relative z-0 min-w-0 h-full flex-1 overflow-visible": sidePresence.present(),
                "absolute inset-y-0 end-0 z-0 w-0 invisible pointer-events-none overflow-visible":
                  !sidePresence.present(),
              }}
            >
              <div
                data-slot="session-side-panel-content"
                class="absolute inset-y-0 start-0 h-full"
                style={{ width: screen.side.contentWidth() }}
              >
                <div
                  data-slot="session-side-region"
                  classList={{
                    "absolute inset-x-0 top-0 min-h-0 overflow-visible transition-[height] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none": true,
                    "will-change-[height]": !screen.size.active() && store.sideHeightMotion,
                    "transition-none": screen.size.active() || !store.sideHeightMotion,
                  }}
                  style={{ height: screen.side.region.height() }}
                >
                  <Show when={store.sideRegionPresent}>
                    <div
                      data-slot="session-side-region-presence"
                      data-opened={screen.side.region.open()}
                      class="absolute inset-0"
                      onAnimationEnd={(event) => {
                        if (event.currentTarget !== event.target) return
                        if (event.animationName !== "side-region-presence-out") return
                        if (screen.side.region.open()) return
                        if (sideTerminalVisible()) return
                        setStore("sideRegionPresent", false)
                        setStore("sideReviewPresent", false)
                      }}
                    >
                      <SessionDesktopReview review={review} present={store.sideReviewPresent} />
                    </div>
                  </Show>
                </div>
                <div class="absolute inset-x-0 bottom-0 flex flex-col">
                  <div
                    data-slot="session-side-panel-gap"
                    classList={{
                      "relative z-0 shrink-0 overflow-visible bg-v2-background-bg-deep transition-[height] duration-[40ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none": true,
                      "delay-0": !screen.side.gap.closing(),
                      "delay-[200ms]": screen.side.gap.closing(),
                    }}
                    style={{ height: screen.side.gap.height() }}
                    onPointerDown={() => screen.size.start()}
                  >
                    <Show when={screen.side.layout().stacked}>
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
                    </Show>
                  </div>
                  <div
                    data-slot="session-side-terminal-region"
                    classList={{
                      "relative z-10 min-h-0 shrink-0 overflow-visible transition-[height] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none": true,
                      "will-change-[height]": !screen.size.active() && store.sideHeightMotion,
                      "transition-none": screen.size.active() || !store.sideHeightMotion,
                    }}
                    style={{ height: screen.side.terminal.height() }}
                  >
                    <Show when={store.sideTerminalPresent}>
                      <div
                        data-slot="side-terminal-panel-presence"
                        data-opened={sideTerminalVisible()}
                        class="absolute inset-0 rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
                      >
                        <div data-slot="side-terminal-panel-clip" class="size-full overflow-clip rounded-[10px]">
                          <TerminalPanel
                            fill
                            framed={false}
                            present={store.sideTerminalPresent}
                            contentHeight={screen.side.terminal.contentHeight()}
                          />
                        </div>
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </Show>
        </div>

        <Show when={bottomTerminalPresence.present() || store.bottomTerminalCached}>
          <div
            ref={(element) => setElements("bottomTerminal", element)}
            data-slot="terminal-panel-presence"
            data-opened={bottomTerminalVisible()}
            classList={{
              hidden: !bottomTerminalPresence.present(),
              "relative min-h-0 shrink-0": isDesktop(),
            }}
          >
            <Show when={isDesktop()}>
              <div class="absolute z-10 -top-1 left-0 right-0 h-2" onPointerDown={() => screen.size.start()}>
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
            <TerminalPanel stacked={isDesktop()} present={store.bottomTerminalCached} />
          </div>
        </Show>
      </div>
    </>
  )
}
