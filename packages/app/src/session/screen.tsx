import {
  ErrorBoundary,
  Show,
  Match,
  Switch,
  Suspense,
  lazy,
  createMemo,
  createEffect,
  createComputed,
  on,
} from "solid-js"
import { createStore } from "solid-js/store"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { Icon } from "@opencode-ai/ui/icon"
import { MessageTimeline, SessionSummaryPanel } from "@/session/timeline/message-timeline"
import { useServer } from "@/runtime/server/current"
import { projectForSession } from "@/shell/layout/helpers"
import type { SessionModel } from "@/session/model"
import { SESSION_PANEL_WIDTH_MIN } from "@/session/session-panel-width"
import { SessionPanelFrame } from "@/session/session-frame"
import { TerminalPanel } from "@/session/terminal/panel"
import { useUsageExceededDialogs } from "./usage-exceeded-dialogs"
import { SessionErrorFallback } from "./route-error"
import { createSessionScreenLayout } from "./screen-layout"
import { createSessionReview } from "./review/model"
import { SessionDesktopReview, SessionMobileReview, SessionMobileViewTabs } from "./review/view"
import { SessionContextTab } from "./files/session-context-tab"
import { createSessionTimelineInteraction } from "./timeline/interaction"
import { ActiveSessionComposerRegion, createActiveSessionRegion } from "./composer/region"
import { SessionIdentityHeader } from "./session-identity-header"
import { SessionReviewToggle } from "./header/session-header-actions"
import { createAnimatedPresence } from "@/runtime/animated-presence"

const SessionMobileFiles = lazy(async () => {
  const { SessionMobileFiles } = await import("./files/session-mobile-files")
  return { default: SessionMobileFiles }
})

export function SessionScreen(props: { session: SessionModel }) {
  const session = props.session
  const server = useServer()
  const detailsProject = createMemo(() => {
    const info = session.data.info()
    return info ? projectForSession(info, server.ctx.sync.data.project) : undefined
  })
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
    mobileTerminalCached: false,
    mobileMoveDismissed: false,
    drop: { active: false, label: "" },
  })
  const [elements, setElements] = createStore<{
    side?: HTMLDivElement
    bottomTerminal?: HTMLDivElement
    dropzone?: HTMLDivElement
  }>({})
  const sideVisible = createMemo(() => isDesktop() && screen.side.layout().visible)
  const sideTerminalVisible = createMemo(() => isDesktop() && screen.terminal.side() && screen.terminal.open())
  const bottomTerminalVisible = createMemo(() => isDesktop() && screen.terminal.open() && screen.terminal.bottom())
  const sidePresence = createAnimatedPresence(
    () => sideVisible() || undefined,
    () => elements.side ?? null,
    session.layout.tabKey,
  )
  const bottomTerminalPresence = createAnimatedPresence(
    () => bottomTerminalVisible() || undefined,
    () => elements.bottomTerminal ?? null,
    session.layout.tabKey,
  )
  const dropPresence = createAnimatedPresence(
    () => store.drop.active || undefined,
    () => elements.dropzone ?? null,
    session.layout.tabKey,
  )
  const sideMotion = createMemo<{
    key?: string
    region: boolean
    terminal: boolean
    animateRegion: boolean
    animateTerminal: boolean
  }>((previous) => {
    const key = session.layout.tabKey()
    const region = screen.side.region.open()
    const terminal = sideTerminalVisible()
    const sameTab = previous?.key === key
    return {
      key,
      region,
      terminal,
      animateRegion: !!previous && sameTab && previous.region !== region,
      animateTerminal: !!previous && sameTab && previous.terminal !== terminal,
    }
  })
  const paneAnimating = () =>
    sidePresence.animate() ||
    sideMotion().animateRegion ||
    sideMotion().animateTerminal ||
    bottomTerminalPresence.animate()
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
      setStore("mobileMoveDismissed", false)
      setStore("deferRender", true)
      const owner = session.ownership.capture()
      requestAnimationFrame(() => {
        setTimeout(() => owner.run(() => setStore("deferRender", false)), 0)
      })
    }
    return key
  })
  const review = createSessionReview({ session, screen, deferRender: () => store.deferRender })
  const mobileView = createMemo(() => (screen.terminal.open() ? "terminal" : review.mobile.tab()))
  const conversationVisible = createMemo(() => isDesktop() || mobileView() === "session")
  createEffect(() => {
    if (!isDesktop() && screen.terminal.open()) setStore("mobileTerminalCached", true)
  })
  const composer = createActiveSessionRegion({
    session,
    screen,
    timeline,
  })

  useUsageExceededDialogs()

  const sessionErrorFallback = (error: unknown, reset: () => void) => {
    createEffect(on(session.identity.sessionKey, reset, { defer: true }))
    return <SessionErrorFallback error={error} sessionID={session.identity.params.id} />
  }

  const mobileTabs = () => (
    <Show when={session.identity.sessionKey()} keyed>
      {(_key) => (
        <SessionMobileViewTabs
          current={mobileView()}
          onDetailsOpenChange={review.details.setOpen}
          details={
            !session.data.isChild() && detailsProject()
              ? (close) => (
                  <Show when={detailsProject()}>
                    {(project) => (
                      <SessionSummaryPanel
                        mobile
                        project={project()}
                        directory={session.workspace.directory()}
                        local={!session.workspace.current()}
                        branch={
                          session.shared.data.location.vcs.info({ directory: session.workspace.directory() })?.branch
                            .current
                        }
                        baseBranch={
                          session.shared.data.location.vcs.info({ directory: project().worktree })?.branch.current
                        }
                        diffs={project().vcs ? review.details.diffs() : []}
                        sessionID={session.identity.params.id ?? ""}
                        moveEligible={composer.workspaceMoveEligible()}
                        moveDismissed={store.mobileMoveDismissed}
                        onMoveDismiss={() => setStore("mobileMoveDismissed", true)}
                        onReview={() => {
                          close()
                          review.mobile.setTab("changes")
                          session.layout.view().terminal.close()
                        }}
                        backgroundTasks={composer.region.state.background.tasks()}
                      />
                    )}
                  </Show>
                )
              : undefined
          }
          onSelect={(view) => {
            if (view === "terminal") {
              session.layout.view().terminal.open()
              return
            }
            review.mobile.setTab(view)
            session.layout.view().terminal.close()
          }}
        />
      )}
    </Show>
  )

  const sessionPanelContent = () => (
    <>
      <div
        data-slot="session-dropzone-blur"
        data-visible={store.drop.active}
        class="pointer-events-none absolute inset-0 z-[79] rounded-[inherit] opacity-[0.001] backdrop-blur-[1.5px] transition-opacity duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] will-change-[opacity,backdrop-filter] data-[visible=true]:opacity-100 motion-reduce:transition-none"
        style={{
          "-webkit-mask-image":
            "linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)",
          "-webkit-mask-composite": "source-in",
          "mask-image":
            "linear-gradient(to right, transparent 0%, black 25%, black 75%, transparent 100%), linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)",
          "mask-composite": "intersect",
        }}
      />
      <Show when={dropPresence.present()}>
        <div
          ref={(element) => setElements("dropzone", element)}
          data-component="session-dropzone"
          data-visible={store.drop.active}
          class="pointer-events-none absolute inset-0 z-[80] grid place-items-center overflow-hidden rounded-[inherit] bg-[color-mix(in_srgb,var(--v2-text-text-base)_var(--session-dropzone-wash),transparent)] opacity-100 transition-opacity duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] data-[visible=false]:opacity-0 motion-reduce:transition-none"
        >
          <div class="absolute inset-0 bg-v2-background-bg-base/25" />
          <div
            class="absolute inset-y-0 left-1/2 w-full -translate-x-1/2 md:max-w-200 2xl:max-w-[1000px]"
            style={{
              "-webkit-mask-image":
                "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
              "mask-image": "linear-gradient(to right, transparent 0%, black 12%, black 88%, transparent 100%)",
            }}
          >
            <div
              data-slot="session-dropzone-stripes"
              class="absolute inset-0 opacity-60"
              style={{
                background:
                  "repeating-linear-gradient(135deg, transparent 0px, transparent 12px, color-mix(in srgb, var(--v2-text-text-base) var(--session-dropzone-stripe), transparent) 12px, color-mix(in srgb, var(--v2-text-text-base) var(--session-dropzone-stripe), transparent) 24px)",
                "-webkit-mask-image":
                  "radial-gradient(ellipse 59% 40% at center, black 0%, rgba(0,0,0,0.72) 58%, transparent 100%)",
                "mask-image":
                  "radial-gradient(ellipse 59% 40% at center, black 0%, rgba(0,0,0,0.72) 58%, transparent 100%)",
              }}
            />
          </div>
          <div
            data-slot="session-dropzone-content"
            class="relative flex translate-y-0 flex-col items-center gap-5 opacity-100 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.215,0.61,0.355,1)] data-[visible=false]:translate-y-1 data-[visible=false]:opacity-0 motion-reduce:transition-none"
            data-visible={store.drop.active}
          >
            <div
              data-slot="session-dropzone-upload"
              class="flex size-10 items-center justify-center rounded-full bg-[var(--session-dropzone-card)] text-v2-icon-icon-muted shadow-[var(--v2-elevation-floating)]"
              aria-hidden="true"
            >
              <Icon name="arrow-up" size="normal" class="text-v2-icon-icon-muted" />
            </div>
            <div class="text-[15px] font-[530] leading-6 text-v2-text-text-base">{store.drop.label}</div>
          </div>
        </div>
      </Show>
      <Show when={!isDesktop() && !!session.identity.params.id}>{mobileTabs()}</Show>
      {/* Surface query errors without suspending session metadata while messages load. */}
      <Show when={timeline.resource.error}>
        {(error) => {
          throw error()
        }}
      </Show>
      <div class="relative flex-1 min-h-0 overflow-hidden">
        <Show when={!isDesktop() && store.mobileTerminalCached}>
          <div class="absolute inset-0" classList={{ invisible: mobileView() !== "terminal" }}>
            <TerminalPanel fill embedded present contentHeight="100%" />
          </div>
        </Show>
        <Switch>
          <Match when={!isDesktop() && mobileView() === "terminal"}>
            <></>
          </Match>
          <Match when={!isDesktop() && mobileView() === "usage"}>
            <SessionContextTab />
          </Match>
          <Match when={!isDesktop() && mobileView() === "files"}>
            <Suspense>
              <SessionMobileFiles />
            </Suspense>
          </Match>
          <Match when={session.identity.params.id && review.mobile.changes()}>
            <SessionMobileReview review={review} />
          </Match>
          <Match when={session.identity.params.id}>
            <Show when={isDesktop() && !messagesReady()}>
              <SessionIdentityHeader sessionID={session.identity.params.id ?? ""} session={session.data.info()} />
            </Show>
            <Show when={messagesReady() ? session.identity.params.id : undefined} keyed>
              {(_id) => (
                <MessageTimeline
                  hideHeader={!isDesktop()}
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

      <Show when={conversationVisible() ? session.identity.params.id : undefined} keyed>
        {(_id) => (
          <ActiveSessionComposerRegion
            model={composer}
            session={session}
            onResponseSubmit={timeline.actions.resume}
            onDropStateChange={(drop) => setStore("drop", drop)}
          />
        )}
      </Show>
    </>
  )

  return (
    <>
      <div class="flex-1 min-h-0 flex flex-col gap-2 px-2 pb-[var(--shell-bottom-inset,8px)] pt-[var(--shell-top-inset,8px)]">
        <div ref={screen.panel.ref} class="relative flex-1 min-h-0 flex flex-col md:flex-row gap-2">
          {/* Keep the control outside panel animations; the terminal's 52px header includes a 1px divider. */}
          <Show when={isDesktop() && messagesReady() && session.identity.params.id}>
            <div
              class="absolute end-3 top-0 z-30 flex items-center"
              classList={{ "h-[51px]": sideTerminalVisible(), "h-12": !sideTerminalVisible() }}
              data-slot="session-review-toggle"
            >
              <SessionReviewToggle />
            </div>
          </Show>
          <div
            classList={{
              "@container relative z-10 min-w-0 shrink-0 flex flex-col min-h-0 h-full flex-1 md:flex-none transition-[width]": true,
              "duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] will-change-[width] motion-reduce:transition-none":
                !screen.size.active() && sidePresence.animate(),
              "transition-none": screen.size.active() || !sidePresence.animate(),
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
                    session.layout.view().reviewPanel.resize(width)
                  }}
                />
              </div>
            </Show>
          </div>

          <Show when={sidePresence.present() || store.sideReviewPresent || store.sideTerminalPresent}>
            <div
              ref={(element) => setElements("side", element)}
              data-slot="session-side-panel-presence"
              data-opened={sidePresence.animate() ? sidePresence.show() : undefined}
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
                    "will-change-[height]": !screen.size.active() && store.sideHeightMotion && paneAnimating(),
                    "transition-none": screen.size.active() || !store.sideHeightMotion || !paneAnimating(),
                  }}
                  style={{ height: screen.side.region.height() }}
                >
                  <Show when={store.sideRegionPresent}>
                    <div
                      data-slot="session-side-region-presence"
                      data-opened={sideMotion().animateRegion ? sideMotion().region : undefined}
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
                      "transition-none": !paneAnimating(),
                    }}
                    style={{ height: screen.side.gap.height() }}
                    onPointerDown={() => screen.size.start()}
                  >
                    <Show when={screen.side.layout().stacked}>
                      <ResizeHandle
                        class="!relative !inset-auto !h-full !w-full !transform-none"
                        direction="vertical"
                        size={session.layout.view().terminal.height()}
                        min={100}
                        max={typeof window === "undefined" ? 600 : window.innerHeight * 0.6}
                        collapseThreshold={50}
                        onResize={(height) => {
                          screen.size.touch()
                          session.layout.view().terminal.resize(height)
                        }}
                        onCollapse={() => session.layout.view().terminal.close()}
                      />
                    </Show>
                  </div>
                  <div
                    data-slot="session-side-terminal-region"
                    classList={{
                      "relative z-10 min-h-0 shrink-0 overflow-visible transition-[height] duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none": true,
                      "will-change-[height]": !screen.size.active() && store.sideHeightMotion && paneAnimating(),
                      "transition-none": screen.size.active() || !store.sideHeightMotion || !paneAnimating(),
                    }}
                    style={{ height: screen.side.terminal.height() }}
                  >
                    <Show when={store.sideTerminalPresent}>
                      <div
                        data-slot="side-terminal-panel-presence"
                        data-opened={sideMotion().animateTerminal ? sideMotion().terminal : undefined}
                        class="absolute inset-0 rounded-[10px] bg-v2-background-bg-base shadow-[var(--v2-elevation-raised)]"
                      >
                        <div data-slot="side-terminal-panel-clip" class="size-full overflow-clip rounded-[10px]">
                          <TerminalPanel
                            fill
                            framed={false}
                            present={store.sideTerminalPresent}
                            animate={sidePresence.animate() || sideMotion().animateTerminal}
                            contentHeight={screen.side.terminal.contentHeight()}
                            reserveReviewToggle={!screen.side.region.open()}
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

        <Show when={isDesktop() && (bottomTerminalPresence.present() || store.bottomTerminalCached)}>
          <div
            ref={(element) => setElements("bottomTerminal", element)}
            data-slot="terminal-panel-presence"
            data-opened={bottomTerminalPresence.animate() ? bottomTerminalPresence.show() : undefined}
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
                  size={session.layout.view().terminal.height()}
                  min={100}
                  max={typeof window === "undefined" ? 600 : window.innerHeight * 0.6}
                  collapseThreshold={50}
                  onResize={(height) => {
                    screen.size.touch()
                    session.layout.view().terminal.resize(height)
                  }}
                  onCollapse={() => session.layout.view().terminal.close()}
                />
              </div>
            </Show>
            <TerminalPanel
              stacked={isDesktop()}
              present={store.bottomTerminalCached}
              animate={bottomTerminalPresence.animate()}
            />
          </div>
        </Show>
      </div>
    </>
  )
}
