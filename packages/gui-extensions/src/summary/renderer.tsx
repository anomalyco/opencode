import { createEffect, lazy, onCleanup, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { Schema, Struct } from "effect"
import { Changes } from "../review/contract"
import { onIdle, Panel, Sessions, Slot, Storage, Style, useDrawer, usePanel, type Setup } from "../sdk"
import type { Disclosure } from "./panel"
import { SummaryHeader } from "./popover"

const Prefs = Schema.Struct({ projectExpanded: Schema.Boolean, serverExpanded: Schema.Boolean }).mapFields(
  Struct.map(Schema.mutableKey),
)

const setup: Setup = (ctx) => {
  const sessions = ctx.use(Sessions)
  const changes = ctx.use(Changes)
  const [prefs, setPrefs] = ctx.use(Storage).store("prefs", {
    schema: Prefs,
    initial: { projectExpanded: true, serverExpanded: true },
    from: {
      key: "settings.v3",
      pick: (value: { sessionSummary?: unknown } | null) => value?.sessionSummary,
    },
  })
  const disclosure: Disclosure = {
    project: () => prefs.projectExpanded,
    server: () => prefs.serverExpanded,
    setProject: (expanded) =>
      setPrefs((draft) => {
        draft.projectExpanded = expanded
      }),
    setServer: (expanded) =>
      setPrefs((draft) => {
        draft.serverExpanded = expanded
      }),
  }

  const SummaryPanel = lazy(() =>
    Promise.all([import("./panel"), import("./summary.css?inline")]).then(([panel, css]) => {
      ctx.add(Style, css.default)
      return panel
    }),
  )
  // Compile the panel while the app idles, so the first open renders at once.
  ctx.cleanup(onIdle(() => void SummaryPanel.preload()))

  ctx.add(Slot, {
    at: "session.header",
    order: 20,
    render: (input) => (
      <SummaryHeader session={input.session} active={input.active} panel={SummaryPanel} disclosure={disclosure} />
    ),
  })

  // The narrow-screen details drawer, offered for root sessions of a project.
  const panel: Panel = {
    id: "main",
    region: "side",
    mobile: {
      get title() {
        return ctx.t("title")
      },
      order: 20,
      kind: "drawer",
    },
    list: () => [],
    render: (_tab, session) => {
      const frame = usePanel()
      const drawer = useDrawer()
      const [store, setStore] = createStore({ dismissed: false })
      createEffect(() => {
        const service = changes()
        if (!service || !frame.visible()) return
        onCleanup(service.watch(session, "details"))
      })
      return (
        <Show when={session.project}>
          {(project) => (
            <Suspense>
              <SummaryPanel
                mobile
                shown={frame.visible()}
                session={session}
                project={project()}
                diffs={project().vcs ? changes()?.details(session) : []}
                moveDismissed={store.dismissed}
                onMoveDismiss={() => setStore("dismissed", true)}
                onReview={
                  changes()
                    ? () => {
                        drawer?.close()
                        changes()?.open(session)
                      }
                    : undefined
                }
                disclosure={disclosure}
              />
            </Suspense>
          )}
        </Show>
      )
    },
  }
  ctx.add(Panel, () => {
    const session = sessions.current()
    if (!session?.project || session.server.data.session.get(session.id)?.parentID) return
    return panel
  })
}

export default setup
