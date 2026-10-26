import { createStore } from "solid-js/store"
import { Show } from "solid-js"
import { TourCard, TourPill, verdictLabel, verdictPrompt, type TourStatus } from "./card"
import type { TourStop, TourVerdict } from "./manifest"
import { useLanguage } from "@/runtime/i18n/language"

export default {
  title: "OpenCode/Review tour",
  id: "review-tour",
}

const stops: TourStop[] = [
  {
    id: "R-158",
    title: "One search list with sticky sections",
    look: "Sessions list first; ⌥↓ jumps between sections and their headers stick while you scroll.",
    palette: "desktop",
  },
  {
    id: "D-10",
    title: "Activity chip capsule",
    look: "Flip between the chips above the composer while subagents run.",
    options: [
      { label: "1 · Capsule, today's icon", knobs: { "activity.chip": "today" } },
      { label: "3 · Capsule + CSS orb", knobs: { "activity.chip": "orb" } },
    ],
  },
  {
    id: "R-145",
    title: "Sidebar tooltip glides",
    look: "Hover down the tabs: the text swaps at once and only the card's position glides.",
  },
]

// Verdicts stay in the story: the sent line shows the prompt the coordinator would get.
function Fixture(props: { stop: number; editing?: boolean; collapsed?: boolean; verdict?: TourVerdict }) {
  const language = useLanguage()

  const [state, setState] = createStore<{
    stop: number
    editing: boolean
    collapsed: boolean
    selected: { [id: string]: number | undefined }
    verdicts: { [id: string]: TourVerdict | undefined }
    status?: TourStatus
  }>({
    stop: props.stop,
    editing: props.editing ?? false,
    collapsed: props.collapsed ?? false,
    selected: { "D-10": 1 },
    verdicts: props.verdict ? { [stops[props.stop]!.id]: props.verdict } : {},
  })

  const stop = () => stops[state.stop]!

  return (
    <Show
      when={!state.collapsed}
      fallback={
        <button type="button" onClick={() => setState("collapsed", false)}>
          <TourPill stop={stop()} position={state.stop + 1} count={stops.length} />
        </button>
      }
    >
      <TourCard
        stop={stop()}
        position={state.stop + 1}
        count={stops.length}
        verdict={state.verdicts[stop().id]}
        selected={state.selected[stop().id]}
        status={state.status}
        editing={state.editing}
        onEdit={(editing) => setState("editing", editing)}
        onPrevious={() => setState({ stop: Math.max(0, state.stop - 1), status: undefined })}
        onNext={() => setState({ stop: Math.min(stops.length - 1, state.stop + 1), status: undefined })}
        onSelect={(index) => setState("selected", stop().id, index)}
        onVerdict={(verdict) =>
          setState({
            editing: false,
            verdicts: { ...state.verdicts, [stop().id]: verdict },
            status: {
              kind: "sent",
              text: `${verdictPrompt(stop().id, verdict)} · ${verdictLabel(verdict, language.t)}`,
            },
          })
        }
        onCollapse={() => setState("collapsed", true)}
        onClose={() => setState({ stop: 0, status: undefined, verdicts: {} })}
      />
    </Show>
  )
}

export const Decision = { render: () => <Fixture stop={1} /> }

export const Review = { render: () => <Fixture stop={0} /> }

export const Changes = { render: () => <Fixture stop={2} editing /> }

export const Shipped = { render: () => <Fixture stop={0} verdict={{ kind: "ship" }} /> }

export const Collapsed = { render: () => <Fixture stop={1} collapsed /> }
