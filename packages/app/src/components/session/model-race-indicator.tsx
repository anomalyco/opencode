import { createMemo, createSignal, For, Show, type Component } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { useServerSync } from "@/context/server-sync"
import { DialogModelRaceSettings } from "@/components/dialog-model-race-settings"
import { ConfigModelRace } from "@opencode-ai/core/config/model-race"
import { latestModelRace, raceActive, raceModelID, type ModelRaceStatus } from "./model-race-status"

type ModelRaceCandidate = ModelRaceStatus["candidates"][number]

const candidateKey = (candidate: Pick<ModelRaceCandidate, "providerID" | "modelID">) =>
  `${candidate.providerID}/${candidate.modelID}`

const candidateStateClass = (state: ModelRaceCandidate["state"]) => {
  switch (state) {
    case "pending":
      return "bg-[#9ca3af]"
    case "streaming":
      return "bg-[#38bdf8]"
    case "leader":
      return "bg-[#f59e0b]"
    case "winner":
      return "bg-[#10b981]"
    case "completed":
      return "bg-[#06b6d4]"
    case "failed":
      return "bg-[#ef4444]"
    case "cancelled":
      return "bg-[#6b7280]"
  }
}

const formatDuration = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return undefined
  if (value < 1000) return `${Math.round(value)}ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round((value % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function CandidateDetails(props: { candidate: ModelRaceCandidate; race?: ModelRaceStatus }) {
  const language = useLanguage()
  const elapsed = createMemo(() =>
    props.race ? formatDuration(props.race.updatedAt - props.race.startedAt) : undefined,
  )
  const toolCallAt = createMemo(() =>
    props.race && props.candidate.toolCallAt !== undefined
      ? formatDuration(props.candidate.toolCallAt - props.race.startedAt)
      : undefined,
  )

  return (
    <div class="mb-1 ml-3.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-v2-border-border-muted bg-v2-background-bg-layer-02 px-3 py-2 text-11-regular text-v2-text-text-muted">
      <div class="col-span-2 min-w-0 truncate font-mono text-10 text-v2-text-text-faint">
        {props.candidate.providerID}/{props.candidate.modelID}
      </div>
      <span class="text-v2-text-text-faint">{language.t("session.modelRace.state")}</span>
      <span class="text-v2-text-text-base">{props.candidate.state}</span>
      <Show when={props.race}>
        {(race) => (
          <>
            <span class="text-v2-text-text-faint">{language.t("session.modelRace.phase")}</span>
            <span>{race().phase}</span>
            <Show when={race().reason}>
              <span class="text-v2-text-text-faint">{language.t("session.modelRace.reason")}</span>
              <span>{race().reason}</span>
            </Show>
          </>
        )}
      </Show>
      <Show when={props.candidate.ttft !== undefined}>
        <span class="text-v2-text-text-faint">{language.t("session.modelRace.ttft")}</span>
        <span>{formatDuration(props.candidate.ttft)}</span>
      </Show>
      <span class="text-v2-text-text-faint">{language.t("session.modelRace.outputTokens")}</span>
      <span>{props.candidate.tokenCount}</span>
      <Show when={props.candidate.tokensPerSecond !== undefined}>
        <span class="text-v2-text-text-faint">{language.t("session.modelRace.speed")}</span>
        <span>{language.t("session.modelRace.tps", { count: Math.round(props.candidate.tokensPerSecond!) })}</span>
      </Show>
      <Show when={toolCallAt()}>
        {(value) => (
          <>
            <span class="text-v2-text-text-faint">{language.t("session.modelRace.toolCall")}</span>
            <span>{value()}</span>
          </>
        )}
      </Show>
      <Show when={elapsed()}>
        {(value) => (
          <>
            <span class="text-v2-text-text-faint">{language.t("session.modelRace.elapsed")}</span>
            <span>{value()}</span>
          </>
        )}
      </Show>
    </div>
  )
}

export const ModelRacePanel: Component<{ sessionID?: string }> = (props) => {
  const dialog = useDialog()
  const language = useLanguage()
  const models = useModels()
  const serverSync = useServerSync()
  const [open, setOpen] = createSignal(false)
  const [expandedCandidate, setExpandedCandidate] = createSignal<string>()
  const config = createMemo(() => ConfigModelRace.normalize(serverSync().data.config.modelRace))
  const enabled = createMemo(() => config().enabled)
  const race = createMemo(() => latestModelRace(serverSync().session.data.model_race, props.sessionID))
  const candidates = createMemo<ModelRaceStatus["candidates"]>(() => {
    const current = race()
    if (current) return current.candidates
    return config().models.flatMap((id) => {
      const separator = id.indexOf("/")
      if (separator <= 0) return []
      return [
        {
          providerID: id.slice(0, separator),
          modelID: id.slice(separator + 1),
          state: "pending" as const,
          tokenCount: 0,
        },
      ]
    })
  })
  const label = (model: { providerID: string; modelID: string } | undefined) => {
    if (!model) return undefined
    return models.find(model)?.name ?? raceModelID(model)
  }
  const winner = createMemo(() => label(race()?.winner))
  const leaderTPS = createMemo(() => {
    const current = race()
    if (!current?.leader || !raceActive(current)) return undefined
    return current.candidates.find(
      (candidate) =>
        candidate.providerID === current.leader?.providerID && candidate.modelID === current.leader.modelID,
    )?.tokensPerSecond
  })
  const title = createMemo(() => {
    const current = race()
    if (!current) return language.t("session.modelRace.ready")
    if (current.winner) return `${language.t("session.modelRace.winner")}: ${winner()}`
    if (current.leader) return `${language.t("session.modelRace.leader")}: ${label(current.leader)}`
    return current.phase
  })

  return (
    <Show when={enabled() && props.sessionID}>
      <div class="overflow-hidden rounded-[8px] border border-v2-border-border-muted bg-v2-background-bg-layer-01">
        <button
          type="button"
          class="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-12-medium text-v2-text-text-muted transition-colors hover:bg-v2-background-bg-layer-02"
          aria-expanded={open()}
          onClick={() => setOpen((value) => !value)}
        >
          <span
            class="size-2 shrink-0 rounded-full"
            classList={{
              "animate-pulse bg-[var(--v2-text-text-accent)]": race() ? raceActive(race()!) : false,
              "bg-v2-text-text-muted": !race() || !raceActive(race()!),
            }}
          />
          <span class="shrink-0">{language.t("session.modelRace.title")}</span>
          <span class="shrink-0 opacity-50">·</span>
          <span class="shrink-0 opacity-70">
            {language.t("session.modelRace.candidates", { count: candidates().length })}
          </span>
          <span class="min-w-0 truncate">· {title()}</span>
          <Show when={race() && raceActive(race()!) && leaderTPS()}>
            <span class="shrink-0 opacity-60">
              · {language.t("session.modelRace.tps", { count: Math.round(leaderTPS()!) })}
            </span>
          </Show>
          <span class="ml-auto shrink-0 opacity-50">
            <Icon name={open() ? "chevron-down" : "chevron-right"} size="small" />
          </span>
        </button>

        <Show when={open()}>
          <div class="border-t border-v2-border-border-muted">
            <div class="max-h-[min(40vh,280px)] overflow-y-auto overscroll-contain px-3 py-2">
              <For each={candidates()}>
                {(candidate) => (
                  <div>
                    <div class="flex min-w-0 items-center gap-2 py-1.5 text-11-regular text-v2-text-text-muted">
                      <span
                        class={`size-1.5 shrink-0 rounded-full ${candidateStateClass(candidate.state)}`}
                        classList={{
                          "animate-pulse": candidate.state === "streaming" || candidate.state === "leader",
                        }}
                      />
                      <span class="min-w-0 flex-1 truncate">{label(candidate) ?? candidate.modelID}</span>
                      <button
                        type="button"
                        class="flex min-w-0 shrink-0 items-center gap-1.5 rounded px-1 py-0.5 text-11-regular text-v2-text-text-muted transition-colors hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base"
                        aria-expanded={expandedCandidate() === candidateKey(candidate)}
                        aria-label={
                          expandedCandidate() === candidateKey(candidate)
                            ? language.t("session.modelRace.hideDetails")
                            : language.t("session.modelRace.details")
                        }
                        onClick={(event) => {
                          event.stopPropagation()
                          const key = candidateKey(candidate)
                          setExpandedCandidate((current) => (current === key ? undefined : key))
                        }}
                      >
                        <span class="shrink-0">{candidate.state}</span>
                        <Show when={candidate.ttft !== undefined}>
                          <span class="shrink-0 opacity-70">
                            {language.t("session.modelRace.ttft")} {candidate.ttft}ms
                          </span>
                        </Show>
                        <Show when={candidate.tokensPerSecond !== undefined}>
                          <span class="shrink-0 opacity-70">
                            {language.t("session.modelRace.tps", { count: Math.round(candidate.tokensPerSecond!) })}
                          </span>
                        </Show>
                        <Icon
                          name={expandedCandidate() === candidateKey(candidate) ? "chevron-down" : "chevron-right"}
                          size="small"
                        />
                      </button>
                    </div>
                    <Show when={expandedCandidate() === candidateKey(candidate)}>
                      <CandidateDetails candidate={candidate} race={race()} />
                    </Show>
                  </div>
                )}
              </For>
              <Show when={race()?.reason && race()!.reason !== "completed"}>
                <div class="mt-1 border-t border-v2-border-border-muted pt-2 text-11-regular text-v2-text-text-faint">
                  {race()!.reason === "tool-call" ? language.t("session.modelRace.toolCall") : race()!.reason}
                </div>
              </Show>
            </div>
            <button
              type="button"
              class="flex w-full items-center gap-2 border-t border-v2-border-border-muted px-3 py-2 text-left text-11-medium text-v2-text-text-muted transition-colors hover:text-v2-text-text-base"
              onClick={() => dialog.show(() => <DialogModelRaceSettings />)}
            >
              <Icon name="sliders" size="small" />
              <span>{language.t("session.modelRace.manage")}</span>
            </button>
          </div>
        </Show>
      </div>
    </Show>
  )
}
