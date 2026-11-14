import { makeEventListener } from "@solid-primitives/event-listener"
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
  type ParentComponent,
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
import { SessionRouteFrame } from "@/session/session-frame"
import { fileName, knobArgs, labFields, stateArgs, type LabEntry, type StoryArgs } from "./catalog"
import {
  createLabStageState,
  INITIAL_LAB_BROWSE_STATE,
  labStageIndex,
  selectShouldToggleFolder,
  transitionLabBrowse,
  transitionLabStage,
  type LabBrowseEvent,
  type LabStageEffect,
  type LabStageEvent,
} from "./machine"
import { applyMotionPatch, motionFields, motionScopes, motionValues, sameMotion, storyMotion } from "./motion"
import "./inspector.css"

// How long Play holds each state at full speed. Slow motion doubles it while the motion itself runs 4× longer, so
// a transition still finishes and Play keeps moving.
const hold = 1600

const searchIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>`

const themeIcon = `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor"/></svg>`

const gridIcon = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>`

type Row = { id: string; label: string; detail?: string; children?: Row[] }

type LabParams = { story?: string; view?: string }

type LabPlugin = ParentComponent<{ file: string }>

export function LabBrowser(props: {
  params: LabParams
  setParams: (patch: LabParams) => void
  loadCatalog: () => Promise<{ entries: LabEntry[]; failed: number }>
  workspace?: ParentComponent
  plugin: LabPlugin
}) {
  const language = useLanguage()
  const theme = useTheme()
  const [resource] = createResource(() => props.loadCatalog())

  const catalog = () => (resource.loading ? undefined : resource.latest)

  const [scheme, setScheme] = createSignal<"dark" | "light">("dark")
  let palette: CommandPalette | undefined
  let toggle: ((id: string) => void) | undefined
  let focusTree: ((id?: string) => void) | undefined
  let browse = INITIAL_LAB_BROWSE_STATE

  const dispatchBrowse = (event: LabBrowseEvent) => {
    const next = transitionLabBrowse(browse, event)
    browse = next.state
    next.effects.forEach(() => focusTree?.(props.params.story))
  }

  const entries = () => catalog()?.entries ?? []
  const grid = () => props.params.view === "grid"
  const selected = createMemo(() => (grid() ? undefined : entries().find((entry) => entry.file === props.params.story)))

  const open = (file: string) => {
    dispatchBrowse({ type: "story.opened", fromTree: stories.contains(document.activeElement) })
    props.setParams({ story: file, view: undefined })
  }

  const rows = createMemo(() => folder(entries(), []))

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
        selection={props.params.story ? [props.params.story] : []}
        // Digits pick the story's states.
        typeahead={(key) => !/^[0-9]$/.test(key)}
        onReady={(tree) => {
          // Opens the folders down to the story in the address, and later ones picked from the palette.
          createEffect(() => props.params.story && tree.reveal(props.params.story))
          toggle = (id) => tree.expand(id, !tree.isExpanded(id))
          focusTree = (id) => tree.focus(id)
        }}
        // Moving by keys selects as it goes, so a folder opens and closes only by a click, Enter, Space or ←/→.
        onSelect={(_, primary) => {
          if (!primary?.startsWith("folder:")) return primary && open(primary)

          if (selectShouldToggleFolder(browse)) toggle?.(primary)
        }}
        onActivate={(id) => (id.startsWith("folder:") ? toggle?.(id) : open(id))}
      />
    </Show>
  ))

  const stage = pane(() => (
    <Show
      when={!grid()}
      fallback={
        <Show when={catalog()}>
          <Grid
            entries={entries().filter((entry) => entry.title.startsWith("UI/") || isDialogEntry(entry))}
            scheme={untrack(scheme)}
            onOpen={open}
            plugin={props.plugin}
          />
        </Show>
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
        {(entry) => (
          <Stage
            entry={entry}
            inspector={inspector}
            scheme={untrack(scheme)}
            workspace={props.workspace}
            plugin={props.plugin}
          />
        )}
      </Show>
    </Show>
  ))

  const inTree = (event: Event) => event.target instanceof Node && stories.contains(event.target)

  makeEventListener(window, "pointerdown", (event) => dispatchBrowse({ type: "pointer.down", inTree: inTree(event) }), {
    capture: true,
  })
  // Bubbling, so the tree's own pointerup (which completes a press on a selected row) selects first.
  makeEventListener(window, "pointerup", () => dispatchBrowse({ type: "pointer.ended" }))
  makeEventListener(window, "pointercancel", () => dispatchBrowse({ type: "pointer.ended" }))
  makeEventListener(
    window,
    "keydown",
    (event) => dispatchBrowse({ type: "key.down", key: event.key, inTree: inTree(event) }),
    { capture: true },
  )
  makeEventListener(window, "keyup", () => dispatchBrowse({ type: "key.ended" }))
  makeEventListener(window, "blur", () => dispatchBrowse({ type: "window.blurred" }))
  makeEventListener(stage, "focusin", () => dispatchBrowse({ type: "stage.focused" }))

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
              run: () => props.setParams({ view: grid() ? undefined : "grid" }),
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
function Stage(props: {
  entry: LabEntry
  inspector: HTMLElement
  scheme: "dark" | "light"
  workspace?: ParentComponent
  plugin: LabPlugin
}) {
  const Workspace: ParentComponent = props.workspace ?? ((props) => props.children)

  const language = useLanguage()
  const entry = props.entry
  const fields = labFields(entry)
  const names = entry.states.map((state) => state.name)
  const [args, setArgs] = createStore<StoryArgs>(stateArgs(entry, 0))
  const [stageState, setStageState] = createSignal(createLabStageState(names))
  const index = createMemo(() => labStageIndex(stageState()))
  const [canvas, setCanvas] = createSignal<HTMLDivElement>()
  const component = entry.component
  const fallback = component && ((values: StoryArgs) => <Dynamic component={component} {...values} />)
  // Switching to a state that shares the current render function keeps the mounted instance, so its transitions play.
  const render = () => entry.states[index()]?.render ?? entry.render ?? fallback
  let timer: ReturnType<typeof setTimeout> | undefined

  // A state is a variant: its chip, a digit, `[` and `]` and Play all apply it, so the panel shows where it is.
  const preset = (next: number): void => store.preset(next === 0 ? "default" : (names[next] ?? "default"))

  // One batch, so a state with its own render function never renders with the previous state's args.
  const dispatch = (event: LabStageEvent) =>
    batch(() => {
      const next = transitionLabStage(untrack(stageState), event)
      setStageState(next.state)
      next.effects.forEach(perform)
    })

  const perform = (effect: LabStageEffect) => {
    if (effect.type === "timer.schedule") {
      clearTimeout(timer)
      timer = setTimeout(
        () => dispatch({ type: "tick", attempt: effect.attempt }),
        (hold * (motionGlobals.slow.value ? 2 : 1)) / motionGlobals.speed.value,
      )

      return
    }

    if (effect.type === "timer.clear") return clearTimeout(timer)

    if (effect.type === "state.apply") {
      setArgs(reconcile(stateArgs(entry, effect.index)))

      if (effect.preset === "now") preset(effect.index)

      // Undo or a reset moved the state: bring the other knobs to the state's args too.
      if (effect.preset === "later")
        queueMicrotask(() => {
          if (untrack(stageState).status !== "disposed") preset(effect.index)
        })

      return
    }

    // Coalesced: a story registers its replay buttons one by one.
    if (effect.type === "motion.queue") return queueMicrotask(() => dispatch({ type: "motion.flushed" }))
    const next = storyMotion(entry.motion)

    if (!sameMotion(next, motion)) return setShown(next)
    store.sync(motionValues(motion))
  }

  const [first, ...rest] = names

  const states: { [key: string]: Field } =
    first === undefined || rest.length === 0
      ? {}
      : {
          // Story args can themselves be named `state` (e.g. the touch composer) or `play`.
          "lab.preset": choice(first, [first, ...rest], { variants: true }),
          "lab.playback": toolbar(
            [
              {
                id: "previous",
                label: language.t("lab.previous"),
                icon: "M200 48 80 128l120 80ZM48 48h16v160H48Z",
                run: () => dispatch({ type: "step", delta: -1 }),
              },
              { id: "play", label: language.t("lab.play"), icon: "play", run: () => dispatch({ type: "play" }) },
              { id: "pause", label: language.t("lab.pause"), icon: "pause", run: () => dispatch({ type: "pause" }) },
              {
                id: "next",
                label: language.t("lab.next"),
                icon: "M56 48l120 80-120 80ZM192 48h16v160h-16Z",
                run: () => dispatch({ type: "step", delta: 1 }),
              },
            ],
            { labels: false, label: language.t("lab.play") },
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

          if (!("lab.preset" in patch)) {
            if (meta.source !== "preset") dispatch({ type: "pause" })

            return setArgs(Object.fromEntries(Object.entries(patch).filter(([key]) => key in fields)))
          }

          dispatch({ type: "panel.state", name: String(values["lab.preset"]), fromPreset: meta.source === "preset" })
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
        // At some pane widths automatic sizing alternates between chips and a list on every frame.
        presetDisplay: "chips",
        header: { title: false, buttons: ["undo", "redo", "reset"] },
        variants: false,
        session: false,
        empty: language.t("lab.noControls"),
        hints: { digits: "always" },
      }),
    )

    // A rebuild stays on the state it was showing, and its fresh knobs show that state's args.
    if (rest.length > 0)
      untrack(() => {
        setArgs(reconcile(stateArgs(entry, index())))
        preset(index())
      })
  })

  onCleanup(motionTuning.subscribe(() => dispatch({ type: "motion.changed" })))
  onCleanup(() => dispatch({ type: "disposed" }))

  if (names.length > 1) {
    bindPresetNumbers(props.inspector, names.length, (number) => dispatch({ type: "select", index: number - 1 }))
  }

  return (
    // Contained layout makes the canvas hold its stories' dialogs, which the provider below portals into it.
    // A press inside the story (its own replay buttons, a dock) stops Play rather than being undone by it.
    <div
      ref={setCanvas}
      class="flex size-full overflow-auto bg-v2-background-bg-base [contain:layout]"
      classList={{ "items-center justify-center p-8": !entry.fullscreen, "flex-col": entry.fullscreen }}
      onPointerDown={() => dispatch({ type: "pause" })}
    >
      <Workspace>
        <props.plugin file={entry.file}>
          <Show when={render()} keyed fallback={language.t("lab.empty")}>
            {(fn) => (
              <DialogProvider container={canvas()}>
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
              </DialogProvider>
            )}
          </Show>
        </props.plugin>
      </Workspace>
    </div>
  )
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
function Grid(props: {
  entries: LabEntry[]
  scheme: "dark" | "light"
  onOpen: (file: string) => void
  plugin: LabPlugin
}) {
  const language = useLanguage()
  const owner = getOwner()
  let element!: HTMLDivElement

  onMount(() => {
    const visibility = new Map<Element, (visible: boolean) => void>()

    const observer = new IntersectionObserver(
      (entries) => batch(() => entries.forEach((entry) => visibility.get(entry.target)?.(entry.isIntersecting))),
      { root: element },
    )

    const board = canvas(element, {
      theme: props.scheme,
      label: language.t("lab.grid"),
      // Neighbours share the library's folder: actions, forms, overlays, then app dialogs.
      items: props.entries
        .toSorted((a, b) => folderOf(a).localeCompare(folderOf(b)))
        .map((entry) => {
          const size = tileSize(entry)

          return {
            id: entry.file,
            title: entry.title.split("/").at(-1),
            w: size.w,
            h: size.h,
            render: (card: HTMLElement) =>
              createRoot((dispose) => {
                // The shell keeps its size and hit target as previews enter and leave the viewport.
                card.dataset.labStory = entry.file
                const [visible, setVisible] = createSignal(false)
                visibility.set(card, setVisible)
                observer.observe(card)
                insert(card, () => (
                  <Show when={visible()}>
                    <Tile entry={entry} plugin={props.plugin} />
                  </Show>
                ))
                onCleanup(() => {
                  observer.unobserve(card)
                  visibility.delete(card)
                })

                return dispose
              }, owner ?? undefined),
          }
        }),
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
      observer.disconnect()
      board.dispose()
    })
  })

  return <div ref={element} class="size-full" />
}

// A story's first state at its natural size, holding its own dialogs as the stage does.
function Tile(props: { entry: LabEntry; plugin: LabPlugin }) {
  const [canvas, setCanvas] = createSignal<HTMLDivElement>()
  const component = props.entry.component
  const render = props.entry.gridPreview ?? props.entry.states[0]?.render ?? props.entry.render

  return (
    <div
      ref={setCanvas}
      inert
      class="relative flex size-full cursor-pointer overflow-hidden bg-v2-background-bg-base [contain:layout]"
      classList={{
        "items-center justify-center p-4": !props.entry.fullscreen,
        "flex-col": props.entry.fullscreen,
      }}
    >
      {/* The provider waits for the card, so a story that opens a dialog at once opens it inside. */}
      <Show when={canvas()}>
        {(container) => (
          <div class="pointer-events-none contents">
            <props.plugin file={props.entry.file}>
              <DialogProvider container={container()}>
                <ErrorBoundary
                  fallback={(error) => <pre class="font-mono text-[11px] text-v2-state-fg-danger">{String(error)}</pre>}
                >
                  {render
                    ? untrack(() => render(stateArgs(props.entry, 0)))
                    : component && <Dynamic component={component} {...stateArgs(props.entry, 0)} />}
                </ErrorBoundary>
              </DialogProvider>
            </props.plugin>
          </div>
        )}
      </Show>
    </div>
  )
}

function isDialogEntry(entry: LabEntry) {
  return entry.title.startsWith("App/Dialogs/") || entry.file.endsWith("/overlays/dialog/dialog.stories.tsx")
}

function tileSize(entry: LabEntry) {
  if (entry.fullscreen) return { w: 1120, h: 720 }

  if (isDialogEntry(entry)) return { w: 720, h: 820 }

  return { w: 320, h: 240 }
}

function folderOf(entry: LabEntry) {
  if (isDialogEntry(entry)) return `1:dialogs:${entry.title}`

  return `0:${entry.file.match(/ui\/src\/([^/]+)\//)?.[1] ?? ""}`
}

function typing(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select"))
}

function bindPresetNumbers(inspector: HTMLElement, count: number, select: (number: number) => void) {
  let pending: { number: number; timer: ReturnType<typeof setTimeout> } | undefined

  const clear = () => {
    clearTimeout(pending?.timer)
    pending = undefined
  }

  const keydown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey ||
      typing(event.target) ||
      !/^[0-9]$/.test(event.key)
    )
      return clear()

    if (!pending && (event.key === "0" || Number(event.key) > count)) return

    event.preventDefault()
    event.stopPropagation()

    if (event.repeat) return

    const number = (pending?.number ?? 0) * 10 + Number(event.key)
    clear()

    if (number > count) return

    if (number * 10 > count) return select(number)

    // A prefix can be a preset on its own. Wait for the next digit before mounting a story that might take focus.
    pending = {
      number,
      timer: setTimeout(() => {
        pending = undefined
        select(number)
      }, 450),
    }
  }

  // Knobs handles single digits on a focused preset strip before the event reaches the window.
  makeEventListener(
    inspector,
    "keydown",
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".knobs-presets") &&
        !event.target.closest(".knobs-card")
      )
        keydown(event)
    },
    { capture: true },
  )
  makeEventListener(window, "keydown", keydown)
  makeEventListener(window, "pointerdown", clear, { capture: true })
  makeEventListener(window, "blur", clear)
  onCleanup(clear)
}

function pane(content: () => JSX.Element) {
  const element = document.createElement("div")

  element.className = "size-full"
  insert(element, content)

  return element
}
