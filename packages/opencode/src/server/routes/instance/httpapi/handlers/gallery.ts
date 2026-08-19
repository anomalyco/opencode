import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { discoverGalleryHosts, type GalleryHost } from "@/local/model-gallery/hosts"
import { evaluateFitAcrossHosts, type FitCandidate } from "@/local/model-gallery/fit"
import { joinGalleryRows } from "@/local/model-gallery/join"
import { hardCompatibility } from "@/local/model-gallery/filter"
import { classifyRow } from "@/local/model-gallery/classify"
import { scoreRow } from "@/local/model-gallery/rank"
import { loadCatalogCandidates } from "@/local/model-gallery/catalog"
import { InstanceHttpApi } from "../api"

// Serves the gallery data plane over the one typed surface the app and TUI
// share (model-gallery-ui task 5.7). All the reasoning lives in
// src/local/model-gallery/* as pure functions; this file only sequences them
// and shapes the wire response.

export const galleryHandlers = HttpApiBuilder.group(InstanceHttpApi, "gallery", (handlers) =>
  Effect.gen(function* () {
    const hosts = Effect.fn("GalleryHttpApi.hosts")(function* () {
      const found = yield* Effect.promise(() => discoverGalleryHosts())
      return found.map(toHostInfo)
    })

    const evaluate = Effect.fn("GalleryHttpApi.evaluate")(function* ({ payload }: { payload: EvaluatePayload }) {
      const discovered = yield* Effect.promise(() => discoverGalleryHosts())
      const wanted = new Set(payload.hostIds ?? [])
      const selected = wanted.size > 0 ? discovered.filter((h) => wanted.has(h.id)) : discovered

      const candidates = yield* Effect.promise(() => loadCatalogCandidates(payload.candidateIds))
      if (candidates.length === 0 || selected.length === 0) return []

      const fitCandidates: FitCandidate[] = candidates.map((c) => ({
        candidateId: c.id,
        model: c.repository,
        variants: c.variants
          .filter((v) => typeof v.totalBytes === "number" && v.totalBytes > 0)
          .map((v) => ({ name: v.quantization ?? v.id, fileBytes: v.totalBytes as number })),
        ...(c.parameterCount ? { paramsB: c.parameterCount / 1e9 } : {}),
        ...(payload.desiredContext ? { requestedCtx: payload.desiredContext } : {}),
      }))

      const fits = yield* Effect.promise(() => evaluateFitAcrossHosts(selected, fitCandidates))

      const rows = joinGalleryRows({
        hosts: selected,
        candidates: candidates.map((c) => ({
          candidateId: c.id,
          installedAliases: [c.repository, c.name],
        })),
        fits,
      })

      const byId = new Map(candidates.map((c) => [c.id, c]))
      const entries = rows.flatMap((row) => {
        const candidate = byId.get(row.candidateId)
        if (!candidate) return []

        const compatibility = hardCompatibility(row, candidate, {
          ...(payload.requiredCapabilities ? { requiredCapabilities: payload.requiredCapabilities } : {}),
          ...(payload.desiredContext ? { minContext: payload.desiredContext } : {}),
        })
        // Incompatible rows are dropped by default but can be requested, so
        // the UI can answer "why isn't this offered here" instead of just
        // omitting the host and leaving the user to guess.
        if (!compatibility.compatible && !payload.includeIncompatible) return []

        const host = selected.find((h) => h.id === row.hostId)
        const classification = classifyRow(row, candidate, host?.installedModelIDs ?? [])
        const ranked = scoreRow(row, candidate, {
          ...(payload.desiredContext ? { desiredContext: payload.desiredContext } : {}),
        })

        return [
          {
            candidateId: row.candidateId,
            hostId: row.hostId,
            hostName: row.hostName,
            online: row.online,
            installed: row.installed,
            ...(row.busy === undefined ? {} : { busy: row.busy }),
            fitKnown: row.fitKnown,
            state: classification.state,
            stateDetail: classification.detail,
            ...(classification.replaces ? { replaces: classification.replaces } : {}),
            compatible: compatibility.compatible,
            incompatibleReasons: compatibility.reasons,
            score: ranked.score,
            components: ranked.components,
            bestVariant: row.bestVariant ? toVariantFit(row.bestVariant) : null,
            recommendedVariant: row.recommendedVariant,
            variants: row.variants.map(toVariantFit),
            vramFreeMB: row.vramFreeMB,
            vramTotalMB: row.vramTotalMB,
          },
        ]
      })

      // Best first, stable on ties, so a refresh does not reshuffle under the
      // user's cursor.
      return entries.sort((a, b) => b.score - a.score || a.hostId.localeCompare(b.hostId))
    })

    return handlers.handle("hosts", hosts).handle("evaluate", evaluate)
  }),
)

type EvaluatePayload = {
  candidateIds: readonly string[]
  hostIds?: readonly string[]
  desiredContext?: number
  requiredCapabilities?: readonly string[]
  includeIncompatible?: boolean
}

function toHostInfo(host: GalleryHost) {
  return {
    id: host.id,
    name: host.name,
    baseURL: host.baseURL,
    source: host.source,
    online: host.online,
    installedModelIDs: host.installedModelIDs,
    defaultModel: host.defaultModel,
  }
}

function toVariantFit(v: {
  variantName: string
  fitLevel: string
  maxFitCtx: number
  vramRequiredMB: number
  modelMB: number
  reason: string
}) {
  return {
    variantName: v.variantName,
    fitLevel: v.fitLevel,
    maxFitCtx: v.maxFitCtx,
    vramRequiredMB: v.vramRequiredMB,
    modelMB: v.modelMB,
    reason: v.reason,
  }
}
