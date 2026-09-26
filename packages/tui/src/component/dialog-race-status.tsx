import type { RGBA } from "@opentui/core"
import { createMemo, createSignal } from "solid-js"
import { useSync } from "../context/sync"
import { useTheme, type Theme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../ui/dialog-select"
import { Locale } from "../util/locale"
import * as Model from "../util/model"
import { latestRace, type ModelRaceState } from "../util/model-race"
import { DialogRace } from "./dialog-race"

type Candidate = ModelRaceState["candidates"][number]

const candidateKey = (candidate: Pick<Candidate, "providerID" | "modelID">) =>
  `${candidate.providerID}/${candidate.modelID}`

function stateColor(state: string, theme: Theme): RGBA {
  switch (state) {
    case "pending":
      return theme.textMuted
    case "streaming":
      return theme.info
    case "leader":
      return theme.warning
    case "winner":
      return theme.success
    case "completed":
      return theme.accent
    case "failed":
      return theme.error
    case "cancelled":
      return theme.textMuted
    default:
      return theme.text
  }
}

function formatMs(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return "-"
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
}

function details(candidate: Candidate, race: ModelRaceState) {
  const speed =
    candidate.tokensPerSecond === undefined ? "-" : `${Math.round(candidate.tokensPerSecond)} tok/s`
  const toolCall = candidate.toolCallAt === undefined ? "-" : formatMs(candidate.toolCallAt - race.startedAt)
  return [
    `Provider: ${candidate.providerID}`,
    `Model: ${candidate.modelID}`,
    `State: ${candidate.state}`,
    `Phase: ${race.phase}`,
    `TTFT: ${formatMs(candidate.ttft)}`,
    `Output tokens: ${Locale.number(candidate.tokenCount)}`,
    `Speed: ${speed}`,
    `Tool call: ${toolCall}`,
    `Elapsed: ${formatMs(race.updatedAt - race.startedAt)}`,
    ...(race.reason ? [`Reason: ${race.reason}`] : []),
  ]
}

export function DialogRaceStatus(props: { sessionID?: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()
  const [expanded, setExpanded] = createSignal<string>()
  const enabled = createMemo(() => sync.data.config.modelRace?.enabled === true)
  const race = createMemo(() => (enabled() ? latestRace(sync.data.model_race, props.sessionID) : undefined))

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const current = race()
    const manage: DialogSelectOption<string> = {
      title: "Manage Model Racing",
      description: "Open model racing settings",
      value: "manage",
      onSelect: () => dialog.replace(() => <DialogRace />),
    }
    const close: DialogSelectOption<string> = {
      title: "Close",
      description: "Return to the session",
      value: "close",
      onSelect: () => dialog.clear(),
    }

    if (!enabled()) {
      return [
        {
          title: "Model Racing is disabled",
          description: "Enable it from /race to start racing candidates",
          value: "disabled",
          onSelect: () => undefined,
        },
        manage,
        close,
      ]
    }

    if (!current || current.candidates.length === 0) {
      return [
        {
          title: "Waiting for the next generation",
          description: "Model racing will appear here when a request starts",
          value: "waiting",
          onSelect: () => undefined,
        },
        manage,
        close,
      ]
    }

    return [
      ...current.candidates.map((candidate): DialogSelectOption<string> => {
        const key = candidateKey(candidate)
        const open = expanded() === key
        const name = Model.name(sync.data.provider, candidate.providerID, candidate.modelID)
        const metrics = [
          candidate.ttft === undefined ? undefined : `TTFT ${formatMs(candidate.ttft)}`,
          candidate.tokenCount > 0 ? `${Locale.number(candidate.tokenCount)} tokens` : undefined,
          candidate.tokensPerSecond === undefined ? undefined : `${Math.round(candidate.tokensPerSecond)} tok/s`,
        ].filter(Boolean) as string[]
        return {
          title: name,
          titleView: (
            <span>
              <span style={{ fg: stateColor(candidate.state, theme) }}>●</span>
              <span> {name} </span>
              <span style={{ fg: theme.textMuted }}>{candidate.state}</span>
            </span>
          ),
          description: open ? undefined : metrics.join(" · "),
          details: open ? details(candidate, current) : undefined,
          footer: current.winner && candidateKey(current.winner) === key ? "winner" : undefined,
          value: key,
          onSelect: () => setExpanded((value) => (value === key ? undefined : key)),
        }
      }),
      manage,
      close,
    ]
  })

  return (
    <DialogSelect
      title="Model Racing"
      placeholder="Filter candidates"
      options={options()}
      flat={true}
      renderFilter={false}
    />
  )
}
