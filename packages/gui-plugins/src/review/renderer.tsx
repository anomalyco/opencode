import {
  batch,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  lazy,
  onCleanup,
  Show,
  Suspense,
  untrack,
} from "solid-js"
import { Icon } from "@opencode/ui/icon"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  Command,
  createKeyed,
  LinkHandler,
  MenuItem,
  SettingsPage,
  usePanel,
  type SessionScreen,
  type SessionRef,
  type MountedSession,
  type Plugin,
  type ClosedPanelTab,
} from "@opencode/plugin/gui"
import { BuiltinPanel, onIdle, type BuiltinPanelTab } from "@opencode/plugin/gui/builtin"
import { Changes, type ChangeKind } from "@opencode/plugin/gui/review"
import type Review from "./index"
import { createReviewModel, type Demand, type ReviewModel } from "./model"
import {
  INITIAL_REVIEW_SCREEN_STATE,
  reviewScreenDemand,
  reviewScreenModel,
  reviewScreenModels,
  transitionReviewScreen,
  type ReviewScreenEvent,
  type ReviewScreenState,
} from "./screen-machine"

const TAB = "changes"

const KEY = `review:${TAB}`

const setup: Plugin.Setup<typeof Review> = (ctx) => {
  const owner = getOwner()
  const sessions = ctx.sessions
  const layout = ctx.layout
  const diff = ctx.stores.diff
  const panel = ctx.stores.panel

  // One review model per session screen, like the review the screen created before plugins. The screen keeps it while
  // it is routed, a review panel renders it, or a view watches its changes; it follows the routed session through `view`.
  const [screens, setScreens] = createSignal<ReviewScreenState>(INITIAL_REVIEW_SCREEN_STATE)
  const screenIDs = new WeakMap<SessionScreen, number>()
  const runtimes = new Map<number, { attempt: number; model: ReviewModel; dispose: () => void }>()
  const ids = { screen: 0, lease: 0 }

  const screenID = (screen: SessionScreen) => {
    const existing = screenIDs.get(screen)

    if (existing !== undefined) return existing
    ids.screen += 1
    screenIDs.set(screen, ids.screen)

    return ids.screen
  }

  /** `origin` is the screen and session of the event, which a model the event creates starts from. */
  const dispatchScreen = (event: ReviewScreenEvent, origin?: { screen: SessionScreen; session: MountedSession }) => {
    const next = transitionReviewScreen(untrack(screens), event)

    // One batch, so readers of the state find the models its effects created.
    batch(() => {
      setScreens(next.state)
      next.effects.forEach((effect) => {
        if (effect.type === "model.dispose") {
          const runtime = runtimes.get(effect.screenID)

          if (runtime?.attempt !== effect.attempt) return
          runtimes.delete(effect.screenID)
          runtime.dispose()

          return
        }

        if (!origin) return
        const screen = origin.screen
        const id = effect.screenID

        runtimes.set(
          id,
          createRoot((dispose) => {
            // The routed session of this screen; the last one stays while it routes none.
            const view = createMemo<MountedSession>(
              (last) => (ctx.screen.current() === screen ? sessions.current() : undefined) ?? last,
              origin.session,
            )

            const demand = createMemo(() => reviewScreenDemand(screens(), id), undefined, { equals: sameDemand })

            const model = createReviewModel({
              ctx,
              screen,
              view,
              demand: {
                get tree() {
                  return demand().tree
                },
                get files() {
                  return demand().files
                },
                get panel() {
                  return demand().panel
                },
                get details() {
                  return demand().details
                },
              },
            })

            return { attempt: effect.attempt, model, dispose }
          }, owner),
        )
      })
    })
  }

  // Views receive their screen before the public attachment is published, so initial render effects can watch it.
  const watch = (screen: SessionScreen, source: keyof Demand) => {
    ids.lease += 1
    const watchID = ids.lease
    const id = screenID(screen)

    dispatchScreen({ type: "watch.added", screenID: id, watchID, source })

    return () => dispatchScreen({ type: "watch.removed", screenID: id, watchID })
  }

  createKeyed(
    () => {
      const screen = ctx.screen.current()
      const session = sessions.current()

      return screen && session ? { screen, session } : undefined
    },
    (current) => dispatchScreen({ type: "route.entered", screenID: screenID(current.screen) }, current),
    {
      // The model follows a session switch on the same screen through `view`.
      equals: (previous, next) => previous.screen === next.screen,
      otherwise: () => dispatchScreen({ type: "route.left" }),
    },
  )
  onCleanup(() => dispatchScreen({ type: "disposed" }))

  const liveModel = (state: ReviewScreenState, id: number) => {
    const attempt = reviewScreenModel(state, id)
    const runtime = runtimes.get(id)

    return attempt !== undefined && runtime?.attempt === attempt ? runtime.model : undefined
  }

  const modelFor = (session: SessionRef) => {
    const state = screens()

    return reviewScreenModels(state)
      .map((id) => liveModel(state, id))
      .find((model) => model?.view().key === session.key)
  }

  const count = () => {
    const session = sessions.current()

    return session ? (modelFor(session)?.count() ?? 0) : 0
  }

  // One tab object for every session, so a session switch never renders its trigger again.
  const tab: BuiltinPanelTab = {
    id: TAB,
    get title() {
      return count() > 0 ? ctx.plural("tab.count", count()) : ctx.t("tab.title")
    },
    // The same icon as the empty changes view.
    label: () => (
      <div class="flex items-center gap-1.5">
        <Icon name="review" size="small" />
        <span>{tab.title}</span>
      </div>
    ),
    // Without focusable content the panel itself joins the tab order.
    get tabbable() {
      return !(count() > 0 || layout.sidebar.opened())
    },
    dom: { tab: "session-side-panel-review-tab", panel: "session-side-panel-review-tabpanel" },
  }

  const ReviewPanel = lazy(() => import("./panel"))
  const MobileReview = lazy(() => import("./mobile"))

  onCleanup(onIdle(() => void (layout.narrow() ? MobileReview : ReviewPanel).preload()))

  ctx.add(BuiltinPanel, {
    id: "main",
    region: "side",
    // The split diff needs the wider session minimum while the side region is open.
    get wide() {
      return diff.value.diffStyle === "split"
    },
    legacy: { review: TAB },
    mobile: {
      get title() {
        return ctx.plural("mobile.title", 0)
      },
      order: 10,
      kind: "tab",
    },
    list: (input) => (!layout.narrow() && input.session.project ? [tab] : []),
    // Lists as "Review" rather than the tab's change count.
    closed: (): ClosedPanelTab => ({ title: ctx.t("tab.title"), icon: "review" }),
    render: (props) => {
      const frame = usePanel()
      const id = screenID(props.screen)
      ids.lease += 1
      const panelID = ids.lease

      // The panel holds its screen's model, so a screen it renders before the route publishes it has one at once.
      dispatchScreen(
        { type: "panel.mounted", screenID: id, panelID },
        { screen: props.screen, session: untrack(() => props.session) },
      )
      onCleanup(() => dispatchScreen({ type: "panel.unmounted", screenID: id, panelID }))

      const model = () => liveModel(screens(), id)

      return (
        <Show when={model()} keyed>
          {(model) => {
            createKeyed(frame.visible, () => onCleanup(watch(props.screen, "panel")))

            return (
              <Show
                when={frame.placement() === "mobile"}
                fallback={
                  <div class="flex flex-col h-full overflow-hidden bg-v2-background-bg-base contain-strict">
                    <Show when={model.panelRendered()}>
                      <Suspense>
                        <ReviewPanel
                          review={model}
                          session={props.session}
                          diffStyle={diff.value.diffStyle}
                          onDiffStyleChange={(style) =>
                            diff.update((draft) => {
                              draft.diffStyle = style
                            })
                          }
                          expandMode={panel.value.expandMode}
                          onExpandModeChange={(mode) =>
                            panel.update((draft) => {
                              draft.expandMode = mode
                            })
                          }
                        />
                      </Suspense>
                    </Show>
                  </div>
                }
              >
                <Suspense>
                  <MobileReview review={model} session={props.session} />
                </Suspense>
              </Show>
            )
          }}
        </Show>
      )
    },
  })

  // Opens the review tab, the side region with it, unless the session has no changes to review.
  const show = () => {
    const session = sessions.current()

    if (session?.project && !layout.narrow()) layout.open(KEY, session, { tab: "select" })
  }

  const mac = /(Mac|iPhone|iPad)/.test(navigator.platform)

  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("command.open"),
      group: ctx.t("command.category.view"),
      bind: mac ? "ctrl+meta+r" : "ctrl+alt+r",
      editable: true,
      enabled: !!sessions.current()?.project && !layout.narrow(),
      run: show,
    }),
  )

  ctx.add(MenuItem, (): MenuItem | undefined => {
    const session = sessions.current()

    if (!session?.project || layout.narrow()) return undefined

    return {
      menu: "session.panel",
      id: "open",
      title: ctx.t("tab.title"),
      opened: layout.state(KEY, session) !== "closed",
      description: count() > 0 ? ctx.plural("menu.count", count()) : undefined,
      icon: "review",
      keybind: "review.open",
      order: 10,
      run: show,
    }
  })

  // A review comment in the composer reveals its diff.
  ctx.add(LinkHandler, {
    priority: 1,
    match: (link) => link.origin === "review",
    open(link) {
      const session = sessions.current()

      if (!session || (link.session && link.session.key !== session.key)) return

      batch(() => {
        // Narrow screens keep their view, as they did before plugins.
        if (!layout.narrow() && session.project) layout.open(KEY, session)

        modelFor(session)?.focusFile(link.href)
      })
    },
  })

  const WrapLinesRow = lazy(() => import("./settings"))
  // Settings rows are small; load them while idle so settings opens without a blank row.
  onCleanup(onIdle(() => void WrapLinesRow.preload()))

  // The narrow-screen diff wrap toggle, in its place in the host's General section.
  ctx.add(SettingsPage, {
    id: "mobile-diff",
    page: "general",
    section: "general",
    get title() {
      return ctx.t("settings.wrapLines.title")
    },
    get entries() {
      return [
        { id: "settings-mobile-diff-wrap", title: ctx.t("settings.wrapLines.title"), keywords: "diff wrap lines" },
      ]
    },
    render: () => (
      <Suspense>
        <WrapLinesRow />
      </Suspense>
    ),
  })

  const none: readonly FileDiffInfo[] = []
  const noKinds: ReadonlyMap<string, ChangeKind> = new Map()

  ctx.provide(Changes, {
    diffs: (session) => modelFor(session)?.diffs() ?? none,
    ready: (session) => modelFor(session)?.ready() ?? false,
    kinds: (session) => modelFor(session)?.kinds() ?? noKinds,
    active: (session) => modelFor(session)?.activeFile(),
    details: (session) => modelFor(session)?.details(),
    focus: (session, path) => modelFor(session)?.focusFile(path),
    open(session) {
      // The session details' changes row: narrow screens switch to the Changes view; wide ones open the review tab.
      layout.open(KEY, session)
    },
    watch,
  })
}

function sameDemand(previous: Demand, next: Demand) {
  return (
    previous.tree === next.tree &&
    previous.files === next.files &&
    previous.panel === next.panel &&
    previous.details === next.details
  )
}

export default setup
