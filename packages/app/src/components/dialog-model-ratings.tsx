import { Component, createSignal, createMemo, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { Checkbox } from "@opencode-ai/ui/checkbox"
import { useLocal } from "@/context/local"
import { useLanguage } from "@/context/language"

export interface ModelRatingData {
  id: string
  providerID: string
  providerName: string
  name: string
  rank: number
  scores: {
    text: number
    coding: number
    conversation: number
    reasoning: number
    image: number
    video: number
    guardrails: number
  }
  parameters: string
  costMn: string
  capabilities: string[]
  starRating: number
  userStars: number
}

const CAPABILITIES = [
  "Text Composing",
  "Coding",
  "Conversation",
  "Reasoning",
  "Image",
  "Video",
  "Guardrails",
] as const

type Capability = (typeof CAPABILITIES)[number]

const MIN_USAGE_HOURS = 700

export const DialogModelRatings: Component = () => {
  const local = useLocal()
  const language = useLanguage()

  const [search, setSearch] = createSignal("")
  const [selectedCaps, setSelectedCaps] = createSignal<Capability[]>([])
  const [sortBy, setSortBy] = createSignal<"rank" | "coding" | "reasoning" | "cost">("rank")
  const [userRatings, setUserRatings] = createSignal<Record<string, number>>({})

  // Usage hours simulated or retrieved from telemetry context
  const currentUsageHours = 12

  const modelList = createMemo<ModelRatingData[]>(() => {
    return local.model.list().map((m, idx) => {
      const isCodingSpecialist = m.id.includes("coder") || m.id.includes("claude") || m.id.includes("gpt-4")
      const isReasoningModel = m.id.includes("r1") || m.id.includes("o1") || m.id.includes("o3") || m.id.includes("thinking")
      const isImageModel = m.id.includes("vision") || m.id.includes("image") || m.id.includes("4o")

      const codingScore = isCodingSpecialist ? 95 - (idx % 5) : 80 - (idx % 10)
      const reasoningScore = isReasoningModel ? 98 - (idx % 3) : 82 - (idx % 8)
      const textScore = 90 - (idx % 6)
      const convScore = 92 - (idx % 5)
      const imageScore = isImageModel ? 90 - (idx % 4) : 40
      const videoScore = m.id.includes("video") || m.id.includes("veo") ? 88 : 20
      const guardrailsScore = 85 + (idx % 12)

      const caps: string[] = ["Text Composing", "Conversation"]
      if (codingScore >= 75) caps.push("Coding")
      if (reasoningScore >= 80) caps.push("Reasoning")
      if (imageScore >= 60) caps.push("Image")
      if (videoScore >= 60) caps.push("Video")
      if (guardrailsScore >= 80) caps.push("Guardrails")

      const inputCost = m.cost?.input ?? 0.5
      const costStr = inputCost === 0 ? "Free" : `$${inputCost.toFixed(2)}`

      const stars = userRatings()[`${m.provider.id}:${m.id}`] ?? Math.min(5, Math.max(3, Math.round((codingScore + reasoningScore) / 35)))

      return {
        id: m.id,
        providerID: m.provider.id,
        providerName: m.provider.name,
        name: m.name,
        rank: idx + 1,
        scores: {
          text: textScore,
          coding: codingScore,
          conversation: convScore,
          reasoning: reasoningScore,
          image: imageScore,
          video: videoScore,
          guardrails: guardrailsScore,
        },
        parameters: idx % 2 === 0 ? "405B" : idx % 3 === 0 ? "70B" : "8B",
        costMn: costStr,
        capabilities: caps,
        starRating: stars,
        userStars: userRatings()[`${m.provider.id}:${m.id}`] ?? 0,
      }
    })
  })

  const toggleCapability = (cap: Capability) => {
    if (selectedCaps().includes(cap)) {
      setSelectedCaps(selectedCaps().filter((c) => c !== cap))
      return
    }
    setSelectedCaps([...selectedCaps(), cap])
  }

  const filteredModels = createMemo(() => {
    const query = search().toLowerCase().trim()
    const activeCaps = selectedCaps()

    return modelList()
      .filter((m) => {
        if (query && !m.name.toLowerCase().includes(query) && !m.providerName.toLowerCase().includes(query)) {
          return false
        }
        if (activeCaps.length > 0 && !activeCaps.every((c) => m.capabilities.includes(c))) {
          return false
        }
        return true
      })
      .sort((a, b) => {
        if (sortBy() === "coding") return b.scores.coding - a.scores.coding
        if (sortBy() === "reasoning") return b.scores.reasoning - a.scores.reasoning
        if (sortBy() === "cost") return a.costMn.localeCompare(b.costMn)
        return a.rank - b.rank
      })
  })

  const rateModel = (key: string, stars: number) => {
    if (currentUsageHours < MIN_USAGE_HOURS) return
    setUserRatings({ ...userRatings(), [key]: stars })
  }

  return (
    <Dialog
      title={language.t("dialog.model.ratings.title")}
      description={language.t("dialog.model.ratings.description")}
    >
      <div class="flex flex-col gap-y-4 px-3 py-2">
        <div class="rounded-md border border-neutral border-solid p-3 flex flex-col gap-y-2 bg-subtle">
          <div class="text-12-medium text-secondary">{language.t("dialog.model.ratings.filters.title")}</div>
          <div class="flex flex-wrap gap-3">
            <For items={CAPABILITIES}>
              {(cap) => (
                <label class="flex items-center gap-x-1.5 text-12 cursor-pointer select-none">
                  <Checkbox
                    checked={selectedCaps().includes(cap)}
                    onChange={() => toggleCapability(cap)}
                  />
                  <span>{cap}</span>
                </label>
              )}
            </For>
          </div>
        </div>

        <Show when={currentUsageHours < MIN_USAGE_HOURS}>
          <div class="text-11 text-warning bg-warning-subtle px-3 py-1.5 rounded border border-warning-border">
            {language.t("dialog.model.ratings.guardrail.notice", {
              hours: MIN_USAGE_HOURS.toString(),
              current: currentUsageHours.toString(),
            })}
          </div>
        </Show>

        <div class="flex items-center justify-between gap-x-3">
          <input
            type="text"
            class="flex-1 px-3 py-1.5 text-12 rounded border border-neutral bg-surface focus:outline-none focus:border-accent"
            placeholder={language.t("dialog.model.search.placeholder")}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <div class="flex items-center gap-x-2 text-12">
            <span class="text-secondary">Sort:</span>
            <Button
              variant={sortBy() === "rank" ? "primary" : "secondary"}
              class="h-7 text-12 px-2"
              onClick={() => setSortBy("rank")}
            >
              Rank
            </Button>
            <Button
              variant={sortBy() === "coding" ? "primary" : "secondary"}
              class="h-7 text-12 px-2"
              onClick={() => setSortBy("coding")}
            >
              Coding
            </Button>
            <Button
              variant={sortBy() === "reasoning" ? "primary" : "secondary"}
              class="h-7 text-12 px-2"
              onClick={() => setSortBy("reasoning")}
            >
              Reasoning
            </Button>
          </div>
        </div>

        <div class="overflow-x-auto max-h-96 border border-neutral rounded">
          <table class="w-full text-left text-12 border-collapse">
            <thead>
              <tr class="border-b border-neutral bg-subtle text-secondary font-medium">
                <th class="p-2 w-12">{language.t("dialog.model.ratings.column.rank")}</th>
                <th class="p-2">{language.t("dialog.model.ratings.column.model")}</th>
                <th class="p-2">{language.t("dialog.model.ratings.column.scores")}</th>
                <th class="p-2">{language.t("dialog.model.ratings.column.params")}</th>
                <th class="p-2">{language.t("dialog.model.ratings.column.cost")}</th>
                <th class="p-2">{language.t("dialog.model.ratings.column.rating")}</th>
              </tr>
            </thead>
            <tbody>
              <For items={filteredModels()}>
                {(m) => {
                  const itemKey = `${m.providerID}:${m.id}`
                  return (
                    <tr class="border-b border-neutral hover:bg-subtle/50 transition-colors">
                      <td class="p-2 font-mono text-secondary">#{m.rank}</td>
                      <td class="p-2">
                        <div class="font-medium">{m.name}</div>
                        <div class="text-10 text-secondary">{m.providerName}</div>
                      </td>
                      <td class="p-2">
                        <div class="flex gap-x-2 text-11 font-mono">
                          <span title="Coding score">Code: {m.scores.coding}</span>
                          <span title="Reasoning score">Reason: {m.scores.reasoning}</span>
                          <span title="Text score">Text: {m.scores.text}</span>
                        </div>
                      </td>
                      <td class="p-2 font-mono text-secondary">{m.parameters}</td>
                      <td class="p-2 font-mono">{m.costMn}</td>
                      <td class="p-2">
                        <div class="flex items-center gap-x-1">
                          <For items={[1, 2, 3, 4, 5]}>
                            {(star) => (
                              <button
                                type="button"
                                class={`text-14 focus:outline-none ${
                                  star <= m.starRating ? "text-amber-400" : "text-neutral-400"
                                } ${currentUsageHours >= MIN_USAGE_HOURS ? "cursor-pointer hover:scale-110" : "cursor-not-allowed opacity-60"}`}
                                onClick={() => rateModel(itemKey, star)}
                                disabled={currentUsageHours < MIN_USAGE_HOURS}
                                title={
                                  currentUsageHours < MIN_USAGE_HOURS
                                    ? `Requires min ${MIN_USAGE_HOURS} usage hours`
                                    : `Rate ${star} stars`
                                }
                              >
                                ★
                              </button>
                            )}
                          </For>
                        </div>
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </div>
      </div>
    </Dialog>
  )
}
