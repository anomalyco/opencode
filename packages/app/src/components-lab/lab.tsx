import { makeEventListener } from "@solid-primitives/event-listener"
import { useSearchParams } from "@solidjs/router"
import {
  batch,
  createEffect,
  createMemo,
  createResource,
  createRoot,
  createSignal,
  ErrorBoundary,
  getOwner,
  on,
  onCleanup,
  onMount,
  Show,
  untrack,
  type JSX,
} from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { Dynamic, insert } from "solid-js/web"
import { DialogProvider } from "@opencode/ui/context/dialog"
import { useTheme } from "@opencode/ui/theme"
import { motionGlobals, motionTuning } from "@opencode/ui/motion-tuning"
import { choice, defineControls, matchesCombo, toolbar, type Field } from "knobs"
import { canvas, commandPalette, restyle, split, toast, type CommandPalette } from "knobs/ui"
import { Tree } from "knobs/ui/solid"
import { useLanguage } from "@/runtime/i18n/language"
import { CommentsProvider } from "@/composer/comments"
import { ComposerPersistenceProvider } from "@/composer/persistence"
import { ModelsProvider } from "@/providers/models/models"
import { Contribution } from "@/runtime/extension/render"
import { ServerProvider, useServer } from "@/runtime/server/current"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { SessionRouteFrame } from "@/session/session-frame"
import { SessionUIProvider } from "@/shell/routes/session-ui-provider"
import { FileProvider } from "@/workspaces/files/model"
import { LocationProvider } from "@/workspaces/location"
import {
  fileName,
  knobArgs,
  labEntry,
  labFields,
  stateArgs,
  type LabEntry,
  type StoryArgs,
  type StoryModule,
} from "./catalog"
import { applyMotionPatch, motionFields, motionScopes, motionValues, sameMotion, storyMotion } from "./motion"

// How long Play holds each state at full speed. Slow motion doubles it while the motion itself runs 4× longer, so
// a transition still finishes and Play keeps moving.
const hold = 1600

const searchIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>`

const themeIcon = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/></svg>`

const gridIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>`

// Vite needs the patterns as literals in each call.
const modules = import.meta.glob<StoryModule>([
  "../**/*.stories.tsx",
  "../../../ui/src/**/*.stories.tsx",
  "../../../session-ui/src/**/*.stories.tsx",
  "../../../gui-extensions/src/**/*.stories.tsx",
])

// Each file's text, for the order its states were written in.
const sources = import.meta.glob<string>(
  [
    "../**/*.stories.tsx",
    "../../../ui/src/**/*.stories.tsx",
    "../../../session-ui/src/**/*.stories.tsx",
    "../../../gui-extensions/src/**/*.stories.tsx",
  ],
  { query: "?raw", import: "default" },
)

/** Loads every story file. A file that fails to import is reported rather than hiding the rest. */
async function loadCatalog() {
  const files = Object.entries(modules)
  const results: PromiseSettledResult<LabEntry>[] = []

  // A few files at a time: hundreds of parallel module requests overflow a dev server reached through a proxy.
  for (let index = 0; index < files.length; index += 8) {
    const chunk = files.slice(index, index + 8).map(async ([file, load]) => {
      const [module, source] = await Promise.all([load(), sources[file]?.() ?? ""])

      return labEntry(file, module, source)
    })

    results.push(...(await Promise.allSettled(chunk)))
  }

  return {
    entries: results
      .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .toSorted((a, b) => a.title.localeCompare(b.title)),
    failed: results.filter((result) => result.status === "rejected").length,
  }
}

type Row = { id: string; label: string; detail?: string; children?: Row[] }

/** The development components lab: every story file in knobs' workspace, rendered with the app's providers and theme. */
export default function ComponentsLab() {
  const language = useLanguage()
  const theme = useTheme()
  const [params, setParams] = useSearchParams<{ story?: string; view?: string }>()
  const [catalog] = createResource(loadCatalog)
  const [scheme, setScheme] = createSignal<"dark" | "light">("dark")
  let palette: CommandPalette | undefined
  let toggle: ((id: string) => void) | undefined
  let focusTree: ((id?: string) => void) | undefined
  // While browsing the tree by keys, a story that focuses something as it mounts (a dialog, a field) would take the
  // keys away. A press or Tab anywhere ends browsing; a few returns at most, so a story that traps focus still wins.
  let browsing = 0
  // The key behind the latest selection; none for a press.
  let key: string | undefined

  const entries = () => catalog()?.entries ?? []
  const grid = () => params.view === "grid"
  const selected = createMemo(() => (grid() ? undefined : entries().find((entry) => entry.file === params.story)))

  const open = (file: string) => {
    browsing = stories.contains(document.activeElement) ? 3 : 0
    setParams({ story: file, view: undefined })
  }

  const rows = createMemo(() => folder(entries(), []))

  // A story named by its file name (`?story=review-tour`, as tours and links write it) opens that file.
  createEffect(() => {
    const story = params.story

    if (!story || entries().some((entry) => entry.file === story)) return

    const match = entries().find((entry) => fileName(entry.file) === story)

    if (match) setParams({ story: match.file }, { replace: true })
  })

  const search = () => {
    if (palette?.isOpen) return palette.close()

    palette ??= commandPalette({
      hotkey: false,
      recents: false,
      placeholder: language.t("lab.search"),
      look: { theme: scheme() },
      commands: () =>
        entries().map((entry) => ({
          id: entry.file,
          label: entry.title.split("/").join(" / "),
          hint: fileName(entry.file),
          keywords: entry.states.map((state) => state.name),
          run: () => open(entry.file),
        })),
    })
    palette.open()
  }

  // The palette takes its look when it's made.
  createEffect(
    on(
      scheme,
      () => {
        palette?.dispose()
        palette = undefined
      },
      { defer: true },
    ),
  )

  // Ahead of the app's own palette, which listens on the document.
  makeEventListener(
    window,
    "keydown",
    (event) => {
      if (!matchesCombo("Mod+K", event)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      search()
    },
    { capture: true },
  )

  // A story's modal overlay (a menu or dialog open by default) sets `pointer-events: none` on the body, which would
  // freeze the lab around it. The lab stays usable while it's open.
  const unblock = document.createElement("style")

  unblock.textContent = "body { pointer-events: auto !important; }"
  document.head.append(unblock)

  createEffect(() => theme.previewColorScheme(scheme()))
  onCleanup(() => {
    theme.cancelPreview()
    palette?.dispose()
    unblock.remove()
  })

  createEffect(() => {
    const failed = catalog()?.failed

    if (failed) toast(language.plural("lab.failed", failed))
  })

  // The story's knobs panel mounts in the inspector pane.
  const inspector = pane(() => null)

  const stories = pane(() => (
    <Show when={catalog()}>
      <Tree
        items={rows()}
        detail={(row) => row.detail}
        label={language.t("lab.components")}
        expanded={rows().map((row) => row.id)}
        selection={params.story ? [params.story] : []}
        // Digits pick the story's states.
        typeahead={(key) => !/^[1-9]$/.test(key)}
        onReady={(tree) => {
          // Opens the folders down to the story in the address, and later ones picked from the palette.
          createEffect(() => params.story && tree.reveal(params.story))
          toggle = (id) => tree.expand(id, !tree.isExpanded(id))
          focusTree = (id) => tree.focus(id)
        }}
        // Moving by keys selects as it goes, so a folder opens and closes only by a click, Enter, Space or ←/→.
        onSelect={(_, primary) => {
          if (!primary?.startsWith("folder:")) return primary && open(primary)

          if (key === undefined || key === " ") toggle?.(primary)
        }}
        onActivate={(id) => (id.startsWith("folder:") ? toggle?.(id) : open(id))}
      />
    </Show>
  ))

  const stage = pane(() => (
    <Show
      when={!grid()}
      fallback={
        <Grid
          entries={entries().filter((entry) => entry.title.startsWith("UI/"))}
          scheme={untrack(scheme)}
          onOpen={open}
        />
      }
    >
      <Show
        when={selected()}
        keyed
        fallback={
          <div class="flex size-full items-center justify-center bg-v2-background-bg-base text-[13px] leading-4 text-v2-text-text-faint">
            {language.t("lab.pick")}
          </div>
        }
      >
        {(entry) => <Stage entry={entry} inspector={inspector} scheme={untrack(scheme)} />}
      </Show>
    </Show>
  ))

  makeEventListener(window, "pointerdown", () => ((browsing = 0), (key = undefined)), { capture: true })
  makeEventListener(
    window,
    "keydown",
    (event) => {
      key = event.key

      if (event.key === "Tab") browsing = 0
    },
    { capture: true },
  )
  makeEventListener(stage, "focusin", () => {
    if (browsing-- > 0) focusTree?.(params.story)
  })

  let element!: HTMLDivElement

  onMount(() => {
    const layout = split(element, {
      theme: "dark",
      storage: null,
      panes: [
        {
          id: "stories",
          size: 260,
          min: 200,
          max: 420,
          collapsible: true,
          title: language.t("lab.components"),
          element: stories,
          actions: [
            { label: language.t("lab.search"), icon: searchIcon, shortcut: "Mod+K", run: search },
            {
              label: language.t("lab.grid"),
              icon: gridIcon,
              run: () => setParams({ view: grid() ? undefined : "grid" }),
            },
            {
              label: language.t("lab.theme"),
              icon: themeIcon,
              run: () => setScheme(scheme() === "dark" ? "light" : "dark"),
            },
          ],
        },
        { id: "stage", min: 360, element: stage },
        { id: "inspector", size: 300, min: 260, max: 460, collapsible: true, title: "", element: inspector },
      ],
    })

    createEffect(() => layout.pane("stories").title(language.t("lab.components"), entries().length))
    createEffect(() => layout.pane("inspector").title(selected()?.title.split("/").join(" / ") ?? ""))
    createEffect(on(scheme, (next) => restyle(layout.element, { theme: next }), { defer: true }))
    onCleanup(() => layout.dispose())
  })

  return (
    <SessionRouteFrame padded>
      <div ref={element} data-component="components-lab" class="min-h-0 flex-1" />
    </SessionRouteFrame>
  )
}

/** One story on the app's background, with its args and states as a knobs panel in the inspector. */
function Stage(props: { entry: LabEntry; inspector: HTMLElement; scheme: "dark" | "light" }) {
  const language = useLanguage()
  const entry = props.entry
  const fields = labFields(entry)
  const names = entry.states.map((state) => state.name)
  const [args, setArgs] = createStore<StoryArgs>(stateArgs(entry, 0))
  const [index, setIndex] = createSignal(0)
  const [canvas, setCanvas] = createSignal<HTMLDivElement>()
  const component = entry.component
  const fallback = component && ((values: StoryArgs) => <Dynamic component={component} {...values} />)
  // Switching to a state that shares the current render function keeps the mounted instance, so its transitions play.
  const render = () => entry.states[index()]?.render ?? entry.render ?? fallback
  let timer: ReturnType<typeof setTimeout> | undefined
  // The state Play is moving to. Any other change is a hand's, and a hand's change stops Play.
  let advancing: number | undefined

  // A state is a variant: its chip, a digit, `[` and `]` and Play all apply it, so the panel shows where it is.
  const preset = (next: number): void => store.preset(next === 0 ? "default" : (names[next] ?? "default"))

  const step = (by: number) => preset((index() + by + names.length) % names.length)

  const pause = () => clearTimeout(timer)

  const play = () => {
    clearTimeout(timer)
    timer = setTimeout(
      () => {
        advancing = (index() + 1) % names.length
        preset(advancing)
        play()
      },
      (hold * (motionGlobals.slow.value ? 2 : 1)) / motionGlobals.speed.value,
    )
  }

  const [first, ...rest] = names

  const states: { [key: string]: Field } =
    first === undefined || rest.length === 0
      ? {}
      : {
          state: choice(first, [first, ...rest], { variants: true }),
          play: toolbar(
            [
              {
                id: "previous",
                label: language.t("lab.previous"),
                icon: "M200 48 80 128l120 80ZM48 48h16v160H48Z",
                run: () => step(-1),
              },
              { id: "play", label: language.t("lab.play"), icon: "play", run: play },
              { id: "pause", label: language.t("lab.pause"), icon: "pause", run: () => clearTimeout(timer) },
              {
                id: "next",
                label: language.t("lab.next"),
                icon: "M56 48l120 80-120 80ZM192 48h16v160h-16Z",
                run: () => step(1),
              },
            ],
            { labels: false },
          ),
        }

  // The story's Knobs join its args here, so the inspector is the one place for its controls. Registering a knob or a
  // replay button (as the story mounts) rebuilds it where it was.
  let motion = storyMotion(entry.motion)
  const [shown, setShown] = createSignal(motion, { equals: sameMotion })

  const inspect = () => {
    const scopes = motionScopes(motion)

    return defineControls(
      "components-lab",
      { ...states, ...fields, ...motionFields(motion) },
      {
        storage: null,
        persist: "none",
        // Beta is a production build, where knobs resolves its production entry: the panel mounts only when shipped.
        ship: () => import("knobs/panel"),
        defaultLabel: { ...(first !== undefined && { "": first }), ...scopes.defaultLabels },
        presets: Object.fromEntries(
          entry.states.slice(1).map((state, offset) => [state.name, knobArgs(fields, stateArgs(entry, offset + 1))]),
        ),
        // A state leaves the Knobs where they are: they're the story's tuning, not part of a state.
        inPresets: scopes.inPresets,
        scopedPresets: scopes.scopedPresets,
        onChange: (patch, values, meta) => {
          applyMotionPatch(motion, patch)

          if (!("state" in patch)) {
            if (meta.source !== "preset") pause()

            return setArgs(Object.fromEntries(Object.entries(patch).filter(([key]) => key in fields)))
          }

          // One batch, so a state with its own render function never renders with the previous state's args.
          const next = Math.max(0, names.indexOf(String(values.state)))

          if (next !== advancing) pause()
          advancing = undefined
          batch(() => {
            setArgs(reconcile(stateArgs(entry, next)))
            setIndex(next)
          })

          // Undo or a reset moved the state: bring the other knobs to the state's args too.
          if (meta.source !== "preset") queueMicrotask(() => preset(next))
        },
      },
    )
  }

  let store!: ReturnType<typeof inspect>

  createEffect(() => {
    motion = shown()
    store = untrack(inspect)
    store.sync(motionValues(motion))
    onCleanup(
      store.mount(props.inspector, {
        theme: props.scheme,
        header: { title: false, buttons: ["undo", "redo", "reset"] },
        variants: false,
        session: false,
        empty: language.t("lab.noControls"),
        hints: { digits: "always" },
      }),
    )

    // A rebuild stays on the state it was showing.
    if (rest.length > 0) untrack(() => preset(index()))
  })

  // Coalesced: a story registers its replay buttons one by one.
  let queued = false
  onCleanup(
    motionTuning.subscribe(() => {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        const next = storyMotion(entry.motion)

        if (!sameMotion(next, motion)) return setShown(next)
        store.sync(motionValues(motion))
      })
    }),
  )

  onCleanup(() => clearTimeout(timer))

  makeEventListener(window, "keydown", (event) => {
    const digit = Number(event.key)

    if (names.length < 2 || !Number.isInteger(digit) || digit < 1 || digit > Math.min(9, names.length)) return

    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return
    event.preventDefault()
    preset(digit - 1)
  })

  return (
    // Contained layout makes the canvas hold its stories' dialogs, which the provider below portals into it.
    // A press inside the story (its own replay buttons, a dock) stops Play rather than being undone by it.
    <div
      ref={setCanvas}
      class="flex size-full overflow-auto bg-v2-background-bg-base [contain:layout]"
      classList={{ "items-center justify-center p-8": !entry.fullscreen, "flex-col": entry.fullscreen }}
      onPointerDown={pause}
    >
      <Workspace>
        <Extension file={entry.file}>
          <DialogProvider container={canvas()}>
            <Show when={render()} keyed fallback={language.t("lab.empty")}>
              {(fn) => (
                <ErrorBoundary
                  fallback={(error, reset) => {
                    // A failing state does not stick: the next state or edit tries again.
                    createEffect(on(() => ({ ...args }), reset, { defer: true }))

                    return (
                      <pre class="max-w-full whitespace-pre-wrap font-mono text-[12px] leading-4 text-v2-state-fg-danger">
                        {String(error)}
                      </pre>
                    )
                  }}
                >
                  {untrack(() => fn(args))}
                </ErrorBoundary>
              )}
            </Show>
          </DialogProvider>
        </Extension>
      </Workspace>
    </div>
  )
}

/**
 * The provider stack of a draft session in the first project of the first healthy server, so a story that reads the
 * server, models, location or composer state renders as it does in the app. Without a server, stories render bare.
 */
function Workspace(props: { children: JSX.Element }) {
  const servers = useServers()
  const global = useGlobal()

  // Kept once picked while the server stays listed: a new pick remounts the story, losing whatever it was showing.
  const healthy = createMemo((picked?: ServerConnection.Any) =>
    picked && servers.list.some((conn) => ServerConnection.key(conn) === ServerConnection.key(picked))
      ? picked
      : servers.list.find((conn) => global.servers.health[ServerConnection.key(conn)]?.healthy),
  )

  return (
    <Show when={healthy()} keyed fallback={props.children}>
      {(conn) => (
        <ServerProvider conn={conn}>
          <Project>{props.children}</Project>
        </ServerProvider>
      )}
    </Show>
  )
}

function Project(props: { children: JSX.Element }) {
  const server = useServer()

  // The list puts the most recently active project first, and on a busy server that changes every few seconds. The
  // story keeps the project it started in, so another session's activity never remounts it.
  const directory = createMemo((picked?: string) => {
    const list = server.ctx.projects.list()

    return picked && list.some((project) => project.worktree === picked) ? picked : list[0]?.worktree
  })

  return (
    <Show when={directory()} keyed fallback={props.children}>
      {(directory) => (
        <ModelsProvider directory={directory}>
          <LocationProvider directory={directory}>
            <SessionUIProvider directory={directory} server={server.key}>
              <FileProvider>
                <ComposerPersistenceProvider>
                  <CommentsProvider>{props.children}</CommentsProvider>
                </ComposerPersistenceProvider>
              </FileProvider>
            </SessionUIProvider>
          </LocationProvider>
        </ModelsProvider>
      )}
    </Show>
  )
}

// A story of an extension renders as its contributions do: inside that extension's context from the app's host.
function Extension(props: { file: string; children: JSX.Element }) {
  const id = props.file.match(/gui-extensions\/src\/([^/]+)\//)?.[1]

  return id ? <Contribution extension={id}>{() => props.children}</Contribution> : props.children
}

/** The tree under `path`: a folder for each further title segment and a row for each story, by name. */
function folder(entries: LabEntry[], path: string[]): Row[] {
  const depth = path.length
  const inside = entries.filter((entry) => path.every((segment, index) => entry.title.split("/")[index] === segment))
  const names = [...new Set(inside.flatMap((entry) => entry.title.split("/").slice(depth, -1).slice(0, 1)))]

  return [
    ...names.map((name) => ({
      id: `folder:${[...path, name].join("/")}`,
      label: name,
      children: folder(inside, [...path, name]),
    })),
    ...inside.flatMap((entry) =>
      entry.title.split("/").length === depth + 1
        ? [
            {
              id: entry.file,
              label: entry.title.split("/").at(-1) ?? entry.title,
              // Files may share a title; the file name tells them apart.
              detail:
                inside.filter((other) => other.title === entry.title).length > 1 ? fileName(entry.file) : undefined,
            },
          ]
        : [],
    ),
  ].toSorted((a, b) => a.label.localeCompare(b.label))
}

// knobs' split takes each pane's content as a node; Solid keeps it reactive where it sits.
/** The library's stories on a canvas that pans and zooms, each in its first state; clicking one opens it on its own. */
function Grid(props: { entries: LabEntry[]; scheme: "dark" | "light"; onOpen: (file: string) => void }) {
  const language = useLanguage()
  const owner = getOwner()
  let element!: HTMLDivElement

  onMount(() => {
    const board = canvas(element, {
      theme: props.scheme,
      label: language.t("lab.grid"),
      // Neighbours share the library's folder: actions, forms, overlays and so on.
      items: props.entries
        .toSorted((a, b) => folderOf(a).localeCompare(folderOf(b)))
        .map((entry) => ({
          id: entry.file,
          title: entry.title.split("/").at(-1),
          w: 320,
          h: 240,
          render: (card: HTMLElement) =>
            createRoot((dispose) => {
              insert(card, () => <Tile entry={entry} />)

              return dispose
            }, owner ?? undefined),
        })),
    })

    // The canvas captures the pointer to pan, so a card never sees its click: a press that ends where it began opens
    // the story it began on.
    let press: { file: string; x: number; y: number } | undefined

    const down = (event: PointerEvent) => {
      const file = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-lab-story]") : null

      press = file?.dataset.labStory ? { file: file.dataset.labStory, x: event.clientX, y: event.clientY } : undefined
    }

    const up = (event: PointerEvent) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 4) props.onOpen(press.file)
      press = undefined
    }

    element.addEventListener("pointerdown", down, true)
    window.addEventListener("pointerup", up, true)
    onCleanup(() => {
      element.removeEventListener("pointerdown", down, true)
      window.removeEventListener("pointerup", up, true)
      board.dispose()
    })
  })

  return <div ref={element} class="size-full" />
}

// A story's first state at its natural size, holding its own dialogs as the stage does.
function Tile(props: { entry: LabEntry }) {
  const [canvas, setCanvas] = createSignal<HTMLDivElement>()
  const component = props.entry.component
  const render = props.entry.states[0]?.render ?? props.entry.render

  return (
    <div
      ref={setCanvas}
      data-lab-story={props.entry.file}
      class="relative flex size-full cursor-pointer items-center justify-center overflow-hidden bg-v2-background-bg-base p-4 [contain:layout]"
    >
      {/* The provider waits for the card, so a story that opens a dialog at once opens it inside. */}
      <Show when={canvas()}>
        {(container) => (
          <div class="pointer-events-none contents">
            <DialogProvider container={container()}>
              <ErrorBoundary
                fallback={(error) => <pre class="font-mono text-[11px] text-v2-state-fg-danger">{String(error)}</pre>}
              >
                {render
                  ? untrack(() => render(stateArgs(props.entry, 0)))
                  : component && <Dynamic component={component} {...stateArgs(props.entry, 0)} />}
              </ErrorBoundary>
            </DialogProvider>
          </div>
        )}
      </Show>
    </div>
  )
}

function folderOf(entry: LabEntry) {
  return entry.file.match(/ui\/src\/([^/]+)\//)?.[1] ?? ""
}

function typing(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select"))
}

function pane(content: () => JSX.Element) {
  const element = document.createElement("div")

  element.className = "size-full"
  insert(element, content)

  return element
}
