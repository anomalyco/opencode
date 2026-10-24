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
import { createStore } from "solid-js/store"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import type { FileDiffInfo } from "@opencode/client/promise"
import {
  Command,
  createKeyed,
  LinkHandler,
  MenuItem,
  Panel,
  SettingsPage,
  Slot,
  usePanel,
  type PanelTab,
  type SessionScreen,
  type SessionRef,
  type MountedSession,
  type Setup,
  onIdle,
} from "../sdk"
import { Changes, type ChangeKind } from "./contract"
import type Review from "./index"
import { createReviewModel, type Demand, type ReviewModel } from "./model"

const TAB = "changes"

const KEY = `review:${TAB}`

const setup: Setup<typeof Review> = (ctx) => {
  const owner = getOwner()
  const sessions = ctx.sessions
  const layout = ctx.layout
  const diff = ctx.stores.diff
  const panel = ctx.stores.panel

  // Who shows a screen's changes: the review render, the file tree, and file tabs. Keyed by the session screen, which
  // stays while it routes another session, so a session switch keeps the demand.
  const demands = new WeakMap<SessionScreen, ReturnType<typeof createStore<Demand>>>()

  const demand = (screen: SessionScreen) => {
    const existing = demands.get(screen)

    if (existing) return existing

    const created = createStore<Demand>({ tree: 0, files: 0, panel: 0, details: 0 })

    demands.set(screen, created)

    return created
  }

  // Views receive their screen before the public attachment is published, so initial render effects can watch it.
  const watch = (screen: SessionScreen, source: keyof Demand) => {
    const set = demand(screen)[1]

    set(source, (count) => count + 1)

    return () => set(source, (count) => Math.max(0, count - 1))
  }

  // One review model per session screen, like the review the screen created before extensions, created once the
  // screen routes a session. It follows the routed session, a new object on each switch, through `view`.
  const [entry, setEntry] = createSignal<{ screen: SessionScreen; model: ReviewModel; dispose: () => void }>()

  createKeyed(
    () => ctx.screen.current({ drafts: true }),
    (screen) => {
      const current = untrack(entry)
      const initial = untrack(() => sessions.current({ drafts: true }))

      if (current?.screen === screen || !initial) return

      current?.dispose()
      setEntry(
        createRoot((dispose) => {
          // The routed session of this screen; the last one stays while none is routed for a moment.
          const view = createMemo<MountedSession>(
            (last) =>
              (ctx.screen.current({ drafts: true }) === screen ? sessions.current({ drafts: true }) : undefined) ??
              last,
            initial,
          )

          return { screen, model: createReviewModel({ ctx, screen, view, demand: demand(screen)[0] }), dispose }
        }, owner),
      )
    },
    {
      // A screen that unmounts and remounts in one update keeps its model.
      otherwise: () => {
        const current = untrack(entry)

        queueMicrotask(() => {
          if (sessions.current({ drafts: true }) || untrack(entry) !== current) return

          current?.dispose()
          setEntry(undefined)
        })
      },
    },
  )
  onCleanup(() => untrack(entry)?.dispose())

  const modelFor = (session: SessionRef) => {
    const model = entry()?.model

    return model && model.view().key === session.key ? model : undefined
  }

  const count = () => entry()?.model.count() ?? 0

  // One tab object for every session, so a session switch never renders its trigger again.
  const tab: PanelTab = {
    id: TAB,
    get title() {
      return count() > 0 ? ctx.plural("tab.count", count()) : ctx.t("tab.title")
    },
    // Without focusable content the panel itself joins the tab order.
    get tabbable() {
      return !(count() > 0 || layout.sidebar.opened())
    },
    fallback: true,
    dom: { tab: "session-side-panel-review-tab", panel: "session-side-panel-review-tabpanel" },
  }

  const ReviewPanel = lazy(() => import("./panel"))
  const MobileReview = lazy(() => import("./mobile"))

  onCleanup(onIdle(() => void (layout.narrow() ? MobileReview : ReviewPanel).preload()))

  ctx.add(Panel, {
    id: "main",
    region: "side",
    drafts: true,
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
    list: (input) => (!layout.narrow() && input.session.project && input.open.includes(TAB) ? [tab] : []),
    render: (props) => {
      const frame = usePanel()

      // A server switch mounts a new screen before the owned model effect runs. Never render the old screen's model.
      const model = () => {
        const current = entry()

        return current?.screen === props.screen ? current.model : undefined
      }

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

  ctx.add(Command, (): Command | undefined => {
    const session = sessions.current({ drafts: true })

    if (!session) return undefined

    return {
      id: "toggle",
      title: ctx.t("command.toggle"),
      group: ctx.t("command.category.view"),
      section: "navigation",
      bind: "mod+shift+r",
      run: () => layout.toggle(KEY, session, layout.narrow() ? undefined : { tab: "select" }),
    }
  })

  ctx.add(Slot, {
    at: "session.panel.toggle",
    render: (input) => (
      <Tooltip
        class="shrink-0"
        placement="bottom"
        value={
          <>
            {ctx.t("command.toggle")}
            <Keybind keys={[...ctx.keybinds.keybind("review.toggle")]} variant="neutral" />
          </>
        }
      >
        <IconButton
          type="button"
          variant="ghost-muted"
          size="large"
          class="shrink-0"
          state={layout.state(KEY, input.session) === "visible" ? "pressed" : undefined}
          onClick={() => layout.toggle(KEY, input.session, layout.narrow() ? undefined : { tab: "select" })}
          aria-label={ctx.t("command.toggle")}
          aria-expanded={layout.state(KEY, input.session) === "visible"}
          aria-controls="review-panel"
          icon={<Icon name="sidebar-right" />}
        />
      </Tooltip>
    ),
  })

  ctx.add(MenuItem, {
    menu: "session.panel",
    id: "open",
    get title() {
      return ctx.t("tab.title")
    },
    icon: "code",
    keybind: "review.toggle",
    order: 30,
    run() {
      const session = sessions.current({ drafts: true })

      if (session) layout.open(KEY, session, layout.narrow() ? undefined : { tab: "select" })
    },
  })

  const reveals = new Set<() => void>()

  // A review comment in the composer reveals its diff.
  ctx.add(LinkHandler, {
    priority: 1,
    match: (link) => link.origin === "review",
    open(link) {
      const session = sessions.current({ drafts: true })

      if (!session || (link.session && link.session.key !== session.key)) return

      batch(() => {
        // Narrow screens keep their view, as they did before extensions.
        if (!layout.narrow() && session.project) layout.open(KEY, session)

        reveals.forEach((listener) => listener())
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
      layout.open(KEY, session, layout.narrow() ? undefined : { tab: "select" })
    },
    watch,
    onReveal(listener) {
      reveals.add(listener)

      return () => {
        reveals.delete(listener)
      }
    },
  })
}

export default setup
