import { Schema } from "effect"

// A tour is a JSON file the dev server serves, named by `?tour=<url>`:
//
//   {
//     "coordinator": "ses_…",
//     "stops": [
//       { "id": "R-158", "title": "One search list", "look": "Sessions list first.", "palette": "desktop" },
//       {
//         "id": "R-145", "title": "Sidebar preview glides", "look": "Hover down the tabs.", "session": "ses_…",
//         "tabs": ["ses_…", "ses_…"], "appearance": { "tabLayout": "vertical", "sidebarOpen": true },
//         "tune": ["Sidebar hover"], "spotlight": "[data-slot=vertical-tabs-sidebar]"
//       },
//       {
//         "id": "D-10", "title": "Activity chip", "look": "Flip the chip above the composer.", "session": "ses_…",
//         "options": [{ "label": "Today", "knobs": { "activity.chip": "today" } }, { "label": "CSS orb", "knobs": { "activity.chip": "orb" } }]
//       }
//     ]
//   }
//
// A stop with options is a decision; any other stop is a review. On arrival a stop opens its tabs, sets its appearance,
// goes to at most one place (`route`, `session`, `settings` or `story`), shows the debug bar, sets its knobs and opens
// the palette with its text. Its spotlight rings briefly, and its `tune` knobs and `tweaks` show in a card above the
// floater. Leaving the stop puts the appearance, the debug bar and the knobs back.

/** A Knobs value: a choice's option, a toggle, a number, or a spring. */
const KnobValue = Schema.Union([
  Schema.String,
  Schema.Boolean,
  Schema.Finite,
  Schema.Struct({ duration: Schema.Finite, bounce: Schema.Finite }),
])

export type KnobValue = typeof KnobValue.Type

const Knobs = Schema.Record(Schema.String, KnobValue)

const Option = Schema.Struct({ label: Schema.String, knobs: Schema.optional(Knobs) })

/**
 * A before/after style to flip in place, such as a label's weight. The first option is the app as built and restyles
 * nothing; each other option sets `property` to its `value` on every element `selector` matches.
 */
const Tweak = Schema.Struct({
  label: Schema.String,
  selector: Schema.String,
  property: Schema.String,
  options: Schema.NonEmptyArray(Schema.Struct({ label: Schema.String, value: Schema.optional(Schema.String) })),
})

export type TourTweak = typeof Tweak.Type

export type TourOption = typeof Option.Type

const Stop = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  /** One line on what to look at. */
  look: Schema.optional(Schema.String),
  /** An app path; `:server` stands for the first healthy server's route segment. */
  route: Schema.optional(Schema.String),
  /** A session on the first healthy server, by id. */
  session: Schema.optional(Schema.String),
  /** A Settings page, such as `appearance`. */
  settings: Schema.optional(Schema.String),
  /** A components-lab story, by file name (`review-tour`) or by the lab's file key. */
  story: Schema.optional(Schema.String),
  /** Sessions on the first healthy server to open as tabs first. */
  tabs: Schema.optional(Schema.Array(Schema.String)),
  appearance: Schema.optional(
    Schema.Struct({
      tabLayout: Schema.optional(Schema.Literals(["horizontal", "vertical", "inbox"])),
      sidebarOpen: Schema.optional(Schema.Boolean),
    }),
  ),
  /** Shows the debug bar, or the bar and its Knobs panel. */
  debug: Schema.optional(Schema.Literals(["bar", "knobs"])),
  knobs: Schema.optional(Knobs),
  /** Knobs to tune in the card above the floater, by id, group or card, as a components-lab story names them. */
  tune: Schema.optional(Schema.Array(Schema.String)),
  tweaks: Schema.optional(Schema.Array(Tweak)),
  /** Text to type into the ⌘K palette; an empty string just opens it. */
  palette: Schema.optional(Schema.String),
  /** A CSS selector to ring. */
  spotlight: Schema.optional(Schema.String),
  options: Schema.optional(Schema.Array(Option)),
})

export type TourStop = typeof Stop.Type

const Manifest = Schema.Struct({
  /** Where verdicts go, as queued prompts. Without one, verdicts stay in the tour. */
  coordinator: Schema.optional(Schema.String),
  stops: Schema.Array(Stop),
})

export type TourManifest = typeof Manifest.Type

export const TourVerdict = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ship") }),
  Schema.Struct({ kind: Schema.Literal("changes"), note: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("skip") }),
  Schema.Struct({ kind: Schema.Literal("pick"), option: Schema.String }),
])

export type TourVerdict = typeof TourVerdict.Type

/** Fetches and checks a tour. Only same-origin URLs load, so a link can't point the tour at another site. */
export async function loadManifest(url: string) {
  const target = new URL(url, location.href)

  if (target.origin !== location.origin) throw new Error(`The tour must be on ${location.origin}`)

  const response = await fetch(target, { cache: "no-store" })

  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)

  const manifest = await Schema.decodeUnknownPromise(Manifest)(await response.json())

  const crowded = manifest.stops.find(
    (stop) => [stop.route, stop.session, stop.settings, stop.story].filter((place) => place !== undefined).length > 1,
  )

  if (crowded) throw new Error(`${crowded.id} goes to more than one place`)

  return manifest
}

/** Every knob a stop may change, including those of its options. */
export function stopKnobs(stop: TourStop) {
  return [
    ...new Set([
      ...Object.keys(stop.knobs ?? {}),
      ...(stop.options ?? []).flatMap((option) => Object.keys(option.knobs ?? {})),
    ]),
  ]
}
