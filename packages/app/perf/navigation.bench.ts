// Moving around the app at 1440×900: Home, new sessions, child sessions, restored tabs and the command palette, on the
// stress fixture (a 12-turn and a 72-turn session with every tool and diffs up to 300 lines, and a subagent's child
// session), paginated as the server does. Every case starts from a fresh document, so each run pays what the first
// visit pays: lazy chunks, the first history page and the first render.
import { bench, web, type Case } from "@hona/strobe"
import { draftHref, sessionHref } from "../e2e/utils/app"
import { messages } from "../e2e/utils/markdown-sessions"
import { mockOpenCodeServer } from "../e2e/utils/mock-server"
import { fixture, installTimelineSettings, mockStressTimeline } from "../e2e/utils/session-fixture"
import { installProjects } from "./fixtures/home"
import { cached } from "./fixtures/mock"
import { installTabs } from "./fixtures/tabs"

const draftID = "draft_perf_navigation"

const last = (ids: string[]) => `[data-message-id="${ids.at(-1)}"]`

const source = last(fixture.expected.sourceMessageIDs)

const target = last(fixture.expected.targetMessageIDs)

const child = last(fixture.expected.childMessageIDs)

const tab = (href: string) => `[data-slot="titlebar-tabs"] a[href="${href}"]`

const tabItem = (href: string) => `[data-slot="titlebar-tabs"] [data-slot="titlebar-tab-item"]:has(a[href="${href}"])`

const home = '[data-component="home-session-search"]'

const homeRow = (sessionID: string) =>
  `[data-component="home-session-row-container"][data-session-id="${sessionID}"] [data-component="home-session-row"]`

const newSession = '[data-component="new-session"] [data-component="composer-editor"][contenteditable="true"]'

const model = '[data-component="new-session"] [data-action="composer-model"]'

const palette = '[role="dialog"] [role="combobox"]'

const selected = '[role="dialog"] [role="option"][aria-selected="true"]'

const paletteList = '[role="dialog"] [data-component="menu-scroll"] > [data-scrollable]'

// Eight restored tabs of a normal 20-message first page each (44 parts, 139 KB).
const restored = Array.from({ length: 8 }, (_, index) => ({
  ...fixture.sessions[0],
  id: `ses_perf_restored_${index}`,
  title: `Renderer review ${index}`,
}))

const pages = Object.fromEntries(
  restored.map((session) => [
    session.id,
    messages[fixture.targetID].slice(-20).map((message) => ({ ...message, id: `${message.id}_${session.id}` })),
  ]),
)

const answer = (sessionID: string) =>
  `[data-timeline-part-id="${pages[sessionID].at(-1)?.id}:text:0"] [data-component="markdown"][data-markdown-ready]`

type Scene = { tabs: string[]; draft?: boolean; first: (server: string) => string; ready: string }

const sourcePage = (server: string) => sessionHref(fixture.sourceID, server)

const inSource: Scene = { tabs: [fixture.sourceID], first: sourcePage, ready: source }

const onHome: Scene = { tabs: [], first: () => "/", ready: homeRow(fixture.targetID) }

const restoring: Scene = {
  tabs: restored.map((session) => session.id),
  first: (server) => sessionHref(restored[0].id, server),
  ready: answer(restored[0].id),
}

/** The places cases start from: open tabs, a first page and what that page shows once ready. */
const scenes = {
  home: onHome,
  "home, new session": { ...onHome, ready: '[data-action="home-new-session"]' },
  source: inSource,
  "source, new session tab": { ...inSource, draft: true },
  "new session page": {
    tabs: [fixture.sourceID, fixture.targetID],
    draft: true,
    first: () => draftHref(draftID),
    ready: newSession,
  },
  restoring,
} satisfies Record<string, Scene>

/** Where each case starts. */
/** What a launch sets up: the scene, and whether setup opens the command palette. */
type Setup = { scene: keyof typeof scenes; palette: boolean }

const sceneOf = new Map<string, keyof typeof scenes>([
  ["open a session from home", "home"],
  ["close the last tab", "source"],
  ["new session from home", "home, new session"],
  ["new session from a session", "source"],
  ["open the new session page", "source, new session tab"],
  ["leave the new session page", "new session page"],
  ["open a child session", "source"],
  ["restore 8 tabs", "restoring"],
  ["activate a restored tab", "restoring"],
  ["search commands in a session", "source"],
  ["search commands on home", "home"],
  ["scroll the command palette", "source"],
])

const fresh: Pick<Case<{}>, "reset"> = {
  async reset({ page, prepared }) {
    await page.goto(prepared.first, { until: prepared.ready, timeout: 60_000 })
    await page.idle()
  },
}

const metrics = ["run.duration", "interaction.p50"]

export default bench({
  // A case's scene, and whether setup opens the command palette: cases with the same ones share a launch.
  setupKey: ({ case: name }): Setup => {
    const scene = sceneOf.get(name)

    if (!scene) throw new Error(`navigation.bench.ts: no scene for "${name}"`)

    return { scene, palette: name === "scroll the command palette" }
  },

  targets: {
    // A target is made before the bench, so its hooks see the setup key as typed here.
    web: web<{}, Setup>({
      expect: { title: "OpenCode" },
      viewport: { width: 1440, height: 900 },
      async prepare(ctx) {
        const { url } = ctx
        const server = new URL(url).origin
        const scene: Scene = scenes[ctx.setupKey.scene]
        const page = cached(ctx)

        if (scene === restoring)
          await mockOpenCodeServer(page, {
            server,
            sessions: restored,
            provider: fixture.provider,
            directory: fixture.directory,
            project: fixture.project,
            pageMessages: (sessionID) => ({ items: pages[sessionID] ?? [] }),
          })
        else await mockStressTimeline(page, { server })
        await installTimelineSettings(page)
        await installProjects(page, [fixture.directory])
        await installTabs(page, {
          server,
          directory: fixture.directory,
          sessions: scene.tabs,
          draft: scene.draft ? draftID : undefined,
        })

        return { server, first: scene.first(server), ready: scene.ready }
      },
      url: ({ prepared }) => prepared.first,
    }),
  },

  async setup({ setupKey, page, prepared }) {
    await page.waitFor(prepared.ready, { timeout: 60_000 })

    if (setupKey.palette) await page.press("ControlOrMeta+Shift+P", { until: paletteList })
    await page.idle()
  },

  cases: {
    "open a session from home": {
      primary: "main.work",
      metrics,
      async run({ page, prepared }) {
        await page.click(homeRow(fixture.targetID), { until: target })
        await page.waitFor(tab(sessionHref(fixture.targetID, prepared.server)))
      },
      ...fresh,
    },

    // As a person closes it: the close button shows on hover.
    "close the last tab": {
      primary: "main.work",
      metrics,
      async run({ page, prepared }) {
        const item = tabItem(sessionHref(fixture.sourceID, prepared.server))
        const close = `${item} [data-slot="tab-close"] button`
        await page.hover(item, { until: close })
        await page.click(close, { until: home })
        await page.waitFor(homeRow(fixture.targetID))
      },
      ...fresh,
    },

    // Ready to type: the composer is editable with the default model.
    "new session from home": {
      primary: "main.work",
      metrics,
      async run({ page }) {
        await page.click('[data-action="home-new-session"]', { until: newSession })
        await page.waitFor(model, { text: "Claude Opus 4.6" })
      },
      ...fresh,
    },

    "new session from a session": {
      primary: "main.work",
      metrics,
      async run({ page }) {
        await page.click('button[aria-label="New session"]', { until: newSession })
        await page.waitFor(model, { text: "Claude Opus 4.6" })
      },
      ...fresh,
    },

    // The new session page's module loads on its first use.
    "open the new session page": {
      primary: "main.work",
      metrics,
      run: ({ page }) => page.click(tab(draftHref(draftID)), { until: newSession }),
      ...fresh,
    },

    "leave the new session page": {
      primary: "main.work",
      metrics,
      run: ({ page, prepared }) => page.click(tab(sessionHref(fixture.targetID, prepared.server)), { until: target }),
      ...fresh,
    },

    // From the subagent card in the source's last turn.
    "open a child session": {
      primary: "main.work",
      metrics,
      run: ({ page, prepared }) =>
        page.click(
          `a[href="${sessionHref(fixture.childID, prepared.server)}"]:has([data-component="task-tool-card"])`,
          {
            until: child,
          },
        ),
      ...fresh,
    },

    // Loading the app with eight tabs to restore, to the active one's last answer on screen. Transcripts fetched
    // (`net.requests` on the history endpoint): the active tab's, not one per restored tab.
    "restore 8 tabs": {
      primary: "main.work",
      metrics: ["run.duration", "net.requests{/api/session/*/message}"],
      run: ({ page, prepared }) => page.goto(prepared.first, { until: prepared.ready, timeout: 60_000 }),
    },

    "activate a restored tab": {
      primary: "main.work",
      metrics: [...metrics, "net.requests{/api/session/*/message}"],
      run: ({ page, prepared }) =>
        page.click(tab(sessionHref(restored[1].id, prepared.server)), { until: answer(restored[1].id) }),
      async reset({ page, prepared }) {
        await page.goto(prepared.first, { until: prepared.ready, timeout: 60_000 })
        // Off the tab strip: a pointer resting on a tab for 100 ms prefetches its transcript.
        await page.hover('[data-component="composer-editor"]')
        await page.idle()
      },
    },

    "search commands in a session": {
      primary: "main.work",
      metrics: ["run.duration", "interaction.p95"],
      async run({ page }) {
        await page.press("ControlOrMeta+Shift+P", { until: palette })
        await page.type(palette, "copy session", { delay: 50 })
        await page.waitFor(selected, { text: "Copy Session ID" })
      },
      async reset({ page }) {
        await page.press("Escape")
        await page.idle()
      },
    },

    "search commands on home": {
      primary: "main.work",
      metrics: ["run.duration", "interaction.p95"],
      async run({ page }) {
        await page.press("ControlOrMeta+Shift+P", { until: palette })
        await page.type(palette, "open settings", { delay: 50 })
        await page.waitFor(selected, { text: "Open settings" })
      },
      async reset({ page }) {
        await page.press("Escape")
        await page.idle()
      },
    },

    // The palette's result list scrolls in a MenuScroll, which moves its thumb on every scroll frame.
    "scroll the command palette": {
      primary: "main.busy",
      metrics: ["main.work", "frames.dropped.pct"],
      async run({ page }) {
        await page.scroll(paletteList, { by: 3000, speed: 3000 })
        await page.scroll(paletteList, { by: -3000, speed: 3000 })
      },
      // Opens the palette again each run, so a run starts at the top even if something closed it.
      async reset({ page }) {
        await page.press("Escape")
        await page.press("ControlOrMeta+Shift+P", { until: paletteList })
        await page.idle()
      },
    },
  },
})
