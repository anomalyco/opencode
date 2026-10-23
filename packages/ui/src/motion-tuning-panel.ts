import { motionPresets, motionTuning, type MotionAction, type MotionKnob, type MotionPreset } from "./motion-tuning"

const global = "Global"

const experiments = "Experiments"

/**
 * Mounts the Motion workspace into `container`: one Global card (speed, slow motion and other settings every surface
 * reads) pinned above a tab per surface, Experiments last. Each tab has its own Shipped, Snappy, Smooth and Calm presets
 * for its springs, then a card per surface or experiment in `order`: its choices and switches, then its tuning, with
 * its replay buttons under a Replay sub-heading. Each card's description sits under its title, and hovering or focusing
 * a card or row outlines the part of the app it changes.
 * knobs loads on first mount, so importing this module costs nothing until then. Works anywhere a surface registered
 * its knobs, including Storybook stories. Returns its removal.
 */
export function mountMotionPanel(
  container: HTMLElement,
  options: { title?: string; section?: string; onClose?: () => void } = {},
) {
  let unmount: (() => void) | undefined
  // The preset chosen to leave a mode, applied once the rebuilt panel has the knobs it sets.
  let switching: { id: string; scope: string } | undefined
  let disposed = false
  let section = options.section

  void start()

  return () => {
    disposed = true
    unmount?.()
  }

  async function start() {
    const [{ action, defineControls }, { applyMotion, motionField }] = await Promise.all([
      import("knobs"),
      import("./motion-tuning-fields"),
    ])

    const show = outline()

    // A lone section needs no tab strip.
    let tabbed = false

    const field = (item: MotionKnob) =>
      motionField(item, {
        label: item.label,
        group: item.card ?? item.group,
        tab: tabbed && item.group !== global ? item.group : undefined,
      })

    // Presets belong to a tab, or to the card when there are no tabs, so a tab without springs shows no strip.
    const scopeOf = (item: MotionKnob) => (tabbed ? item.group : (item.card ?? item.group))

    // Knobs whose `when` doesn't hold are left out; a change to it rebuilds the panel like a new knob would.
    const shown = () => motionTuning.list().filter((item) => item.when?.() ?? true)

    const identity = () => [...shown(), ...motionTuning.actions()].map((item) => `${item.group}/${item.id}`).join()

    // Rebuilt when a surface registers or removes a knob or action.
    const mount = () => {
      unmount?.()
      const all = shown()
      // Modes sit in the preset strip, not as rows. While one is on, the spring presets leave its section's springs alone
      // (choosing one on that section's tab switches back to them first); other sections' springs take presets as usual.
      const active = all.find((item) => item.kind === "mode" && item.value)
      const list = all.filter((item) => item.kind !== "mode")
      const actions = motionTuning.actions()
      const mounted = identity()
      const springs = list.flatMap((item) => (item.kind === "spring" && item.group !== active?.group ? [item] : []))
      // Easing editors open inline, like the spring rows beside them, rather than folded behind a chevron.
      openEditors(list.flatMap((item) => (item.kind === "easing" ? [item.id] : [])))

      const sections = [...new Set([...list, ...actions].map((item) => item.group))]
        .filter((group) => group !== global)
        // Experiments come and go, so they sit last.
        .toSorted((a, b) => Number(a === experiments) - Number(b === experiments))

      tabbed = sections.length > 1

      // A mode sits in the strip only on its own section's tab; switching to or from that tab rebuilds the strip.
      const modes = all.flatMap((item) =>
        item.kind === "mode" && item.group === (section ?? sections[0]) ? [item] : [],
      )

      const scopes = [...new Set([...springs, ...modes].map(scopeOf))]

      // A card takes its place from its first knob, so one experiment's rows never split around another's.
      const cards = [...new Set([...list, ...actions].map(cardOf))]
      const place = new Map(cards.map((card) => [card, list.find((item) => cardOf(item) === card)?.order ?? 0]))

      // What each card explains and outlines, by its knobs group id: the first of its knobs that says.
      const about = new Map(
        cards.flatMap((card) => {
          const info = list.find((item) => cardOf(item) === card && (item.description || item.target))

          return info ? [[card, info] as const] : []
        }),
      )

      const controls = defineControls(
        "opencode-motion",
        {
          // Global first, then each section's cards in order, each card's knobs and replay buttons together.
          ...Object.fromEntries(list.filter((item) => item.group === global).map((item) => [item.id, field(item)])),
          ...Object.fromEntries(
            [...list, ...actions]
              .filter((item) => item.group !== global)
              .toSorted(
                (a, b) =>
                  sections.indexOf(a.group) - sections.indexOf(b.group) ||
                  (place.get(cardOf(a)) ?? 0) - (place.get(cardOf(b)) ?? 0) ||
                  cards.indexOf(cardOf(a)) - cards.indexOf(cardOf(b)) ||
                  tuning(a) - tuning(b),
              )
              .map((item) =>
                "run" in item
                  ? [
                      `action.${item.id}`,
                      action(item.label, {
                        group: item.group,
                        tab: tabbed ? item.group : undefined,
                        subsection: "Replay",
                        run: item.run,
                      }),
                    ]
                  : [item.id, field(item)],
              ),
          ),
        },
        {
          // knobs enables itself only on localhost; this module is only loaded in developer channels.
          enabled: true,
          ship: () => import("knobs/panel"),
          // Global sits above the tabs and presets leave it alone.
          pinned: [global],
          persist: "variants",
          // One muted line under each card's title.
          groupDescriptions: Object.fromEntries(
            [...about].flatMap(([card, info]) => (info.description ? [[card, info.description]] : [])),
          ),
          // Springs ship different presets, so the defaults get their own chip.
          defaultLabel: Object.fromEntries(scopes.map((scope) => [scope, "Shipped"])),
          presetLabels: { ...motionPresets, ...Object.fromEntries(modes.map((item) => [item.id, item.label])) },
          scopedPresets: Object.fromEntries(
            scopes.map((scope) => [
              scope,
              {
                ...Object.fromEntries(
                  // SAFETY: motionPresets' keys are the MotionPreset ids.
                  (Object.keys(motionPresets) as MotionPreset[]).map((id) => [
                    id,
                    Object.fromEntries(
                      springs.flatMap((item) => (scopeOf(item) === scope ? [[item.id, item.presets[id]]] : [])),
                    ),
                  ]),
                ),
                ...Object.fromEntries(modes.flatMap((item) => (scopeOf(item) === scope ? [[item.id, {}]] : []))),
              },
            ]),
          ),
          onChange: (patch) =>
            list.forEach((item) => {
              // SAFETY: each field was made from its knob above, so its value is that knob's kind.
              const value = patch[item.id] as MotionKnob["value"] | undefined

              if (value !== undefined) applyMotion(item, value)
            }),
        },
      )

      const sync = () => controls.sync(Object.fromEntries(list.map((item) => [item.id, item.value])))
      sync()

      // The strip shows the mode that's on; a preset chosen while a mode was on applies once its knobs are back.
      if (active && active.id in (controls.scopes[scopeOf(active)]?.presets ?? {}))
        controls.preset(active.id, { scope: scopeOf(active) })

      if (!active && switching && switching.id in (controls.scopes[switching.scope]?.presets ?? {}))
        controls.preset(switching.id, { scope: switching.scope })
      switching = undefined

      const stopModes = controls.subscribe(() => {
        modes.forEach((item) => {
          const chosen = controls.activePreset(scopeOf(item))
          const on = chosen?.kind === "preset" && chosen.id === item.id

          if (on === item.value) return

          if (!on)
            switching = {
              id: chosen?.kind === "preset" ? chosen.id : chosen ? "" : "default",
              scope: scopeOf(item),
            }
          motionTuning.set(item, on)
        })
      })

      // A row's own target, where it names a narrower one, else its card's.
      const targets = new Map(list.flatMap((item) => (item.target ? [[item.id, item.target] as const] : [])))

      // Experiments fold to one line each, showing what's picked; knobs remembers the ones opened in this session.
      const leads = new Map(
        cards.flatMap((card) => {
          const lead = list.find(
            (item) =>
              cardOf(item) === card && item.group === experiments && (item.kind === "choice" || item.kind === "toggle"),
          )

          return lead ? [[card, lead] as const] : []
        }),
      )

      const stopPanel = controls.mount(container, {
        theme: "auto",
        title: options.title ?? "Knobs",
        onClose: options.onClose,
        // The debug bar shows and hides this panel, and `s` jumps only with focus inside it, so the app keeps its keys.
        toggleKey: false,
        hints: "panel",
        tabs: tabbed ? sections : undefined,
        tab: section,
        groupFolded: Object.fromEntries([...leads.keys()].map((card) => [card, true])),
        // What's picked. The header's reset button already shows when anything else in the card has changed.
        groupSummary: (group) => {
          const lead = leads.get(group)
          const value = lead && controls.get()[lead.id]

          if (!lead || value === undefined) return null

          return lead.kind === "choice" ? (lead.labels[String(value)] ?? String(value)) : value ? "On" : "Off"
        },
        // knobs reports a card or row at most once per frame, and null when nothing in the panel is active.
        onActive: (at) => show(at ? (at.key && targets.get(at.key)) || about.get(at.group)?.target : undefined),
        onTab: (id) => {
          const offered = (tab: string | undefined) => all.some((item) => item.kind === "mode" && item.group === tab)

          const rebuild = offered(section) !== offered(id)
          section = id

          if (rebuild) mount()
        },
      })

      const stopWatch = motionTuning.subscribe(() => {
        // Edits from elsewhere, such as the debug bar's SLOW, show here too.
        if (identity() === mounted) return sync()
        mount()
      })

      unmount = () => {
        stopWatch()
        stopModes()
        show(undefined)
        stopPanel()
      }
    }

    if (!disposed) mount()
  }
}

function cardOf(item: MotionKnob | MotionAction) {
  return ("card" in item ? item.card : undefined) ?? item.group
}

// A card leads with what it switches between, then what tunes it.
function tuning(item: MotionKnob | MotionAction) {
  return "kind" in item && (item.kind === "choice" || item.kind === "toggle") ? 0 : 1
}

// knobs remembers which rows' editors are open in this tab's session; adding ids there opens them on mount.
function openEditors(ids: string[]) {
  if (ids.length === 0 || typeof sessionStorage === "undefined") return
  const key = "knobs:opencode-motion:session:v1"
  const session = JSON.parse(sessionStorage.getItem(key) ?? "{}")
  const expanded: string[] = Array.isArray(session.expanded) ? session.expanded : []

  if (ids.every((id) => expanded.includes(id))) return
  sessionStorage.setItem(key, JSON.stringify({ ...session, expanded: [...new Set([...expanded, ...ids])] }))
}

// Frames the part of the app a card changes: a pointer-transparent outline that fades in and out. Its rects are read
// once per change of target, never per frame.
function outline() {
  const frames: HTMLElement[] = []
  let current: string | undefined

  const clear = () =>
    frames.splice(0).forEach((frame) => {
      frame.style.opacity = "0"
      setTimeout(() => frame.remove(), 200)
    })

  return (target: string | undefined) => {
    if (target === current) return
    current = target
    clear()

    if (!target) return

    document.querySelectorAll(target).forEach((element) => {
      const rect = element.getBoundingClientRect()

      if (rect.width === 0 || rect.height === 0) return
      const frame = document.body.appendChild(document.createElement("div"))

      frame.style.cssText = `position:fixed;z-index:60;pointer-events:none;opacity:0;transition:opacity .15s;border-radius:6px;
        left:${rect.left - 3}px;top:${rect.top - 3}px;width:${rect.width + 6}px;height:${rect.height + 6}px;
        border:1.5px solid var(--border-interactive-base);background:color-mix(in srgb, var(--surface-interactive-base) 50%, transparent)`
      requestAnimationFrame(() => (frame.style.opacity = "1"))
      frames.push(frame)
    })
  }
}
