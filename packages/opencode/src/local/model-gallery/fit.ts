// Multi-host hypothetical fit (model-gallery-ui task 5.2).
//
// For every candidate the gallery is showing, the user's real question is "which
// of my machines can run this, and how big a context do I get". Answering it
// means asking each host about each candidate — a product that grows fast, so
// two things matter: batching and a bound.
//
// Batching is free here because llama-skein's hypothetical-fit endpoint already
// takes a variant LIST. One request carries every quantization of one candidate,
// so the request count is (candidates x hosts), not (candidates x variants x
// hosts). A 20-candidate gallery over 5 hosts with 6 quants each is 100
// requests instead of 600.
//
// The bound exists because these hosts are someone's actual GPUs. An unbounded
// fan-out would open every connection at once to machines that may be mid-
// inference, and the gallery is a background nicety — it must never be the
// reason a user's chat stalls.

import { createClient, createConfig } from "../llama-skein/gen/client"
import { LlamaSkeinClient } from "../llama-skein/gen/sdk.gen"
import type { GalleryHost } from "./hosts"

/** One quantization of one candidate, with the resident size fit depends on. */
export type CandidateVariant = {
  name: string
  fileBytes: number
}

/** A candidate and every variant the gallery might install for it. */
export type FitCandidate = {
  candidateId: string
  /** Free-form label sent to llama-skein; usually the HF repo id. */
  model: string
  variants: readonly CandidateVariant[]
  /** Dense parameter count, used only when no variant size is known. */
  paramsB?: number
  /** Score at this context instead of the trained maximum. */
  requestedCtx?: number
}

/** llama-skein's verdict for one variant on one host. */
export type HostVariantFit = {
  hostId: string
  candidateId: string
  variantName: string
  /**
   * False when the host could not be asked at all — offline, an older build
   * without the endpoint, or a malformed answer. Callers MUST distinguish this
   * from a negative verdict: "we don't know" and "it does not fit" lead to
   * different UI and different decisions.
   */
  known: boolean
  fitLevel: string
  /** Largest context this variant reaches on this host; 0 when unknown. */
  maxFitCtx: number
  vramRequiredMB: number
  modelMB: number
  /** llama-skein's own explanation, when it gave one. */
  reason: string
}

/** Per-host, per-candidate outcome, including hosts that could not answer. */
export type HostCandidateFit = {
  hostId: string
  candidateId: string
  /** False when the whole request failed; variants is then empty. */
  answered: boolean
  /** llama-skein's pick: largest variant scoring perfect/good, else tight. */
  recommendedVariant: string | null
  estimated: boolean
  vramFreeMB: number
  vramTotalMB: number
  variants: HostVariantFit[]
}

export type EvaluateFitOptions = {
  /**
   * Maximum requests in flight across the whole fan-out. Deliberately small:
   * these are GPUs doing real work, and the gallery is not the priority.
   */
  concurrency?: number
  timeoutMs?: number
  /** Injected in tests. */
  fitter?: (baseURL: string) => HypotheticalFitter
}

export type HypotheticalFitter = {
  postHypotheticalFit(args: {
    body: {
      model?: string
      params_b?: number
      requested_ctx?: number
      variants: Array<{ name: string; file_bytes: number }>
    }
  }): Promise<unknown>
}

const DEFAULT_CONCURRENCY = 4
const DEFAULT_TIMEOUT_MS = 8000

function defaultFitter(baseURL: string): HypotheticalFitter {
  return new LlamaSkeinClient({
    client: createClient(createConfig({ baseUrl: baseURL })),
  }) as unknown as HypotheticalFitter
}

/**
 * Ask every online host about every candidate, batching each candidate's
 * variants into a single request per host and capping requests in flight.
 *
 * Offline hosts are skipped rather than attempted — discovery already told us
 * they did not answer, and re-learning that per candidate would multiply the
 * timeout cost by the candidate count. They still produce an unanswered result
 * so task 5.6 can classify them.
 */
export async function evaluateFitAcrossHosts(
  hosts: readonly GalleryHost[],
  candidates: readonly FitCandidate[],
  options: EvaluateFitOptions = {},
): Promise<HostCandidateFit[]> {
  const fitter = options.fitter ?? defaultFitter
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  type Job = { host: GalleryHost; candidate: FitCandidate }
  const jobs: Job[] = []
  const unanswered: HostCandidateFit[] = []
  for (const host of hosts) {
    for (const candidate of candidates) {
      if (!host.online) {
        unanswered.push(emptyFit(host.id, candidate.candidateId))
        continue
      }
      jobs.push({ host, candidate })
    }
  }

  const done = await mapPool(jobs, options.concurrency ?? DEFAULT_CONCURRENCY, async ({ host, candidate }) => {
    try {
      const raw = await withTimeout(
        fitter(host.baseURL).postHypotheticalFit({
          body: {
            model: candidate.model,
            ...(candidate.paramsB && candidate.variants.length === 0 ? { params_b: candidate.paramsB } : {}),
            ...(candidate.requestedCtx ? { requested_ctx: candidate.requestedCtx } : {}),
            variants: candidate.variants.map((v) => ({ name: v.name, file_bytes: v.fileBytes })),
          },
        }),
        timeoutMs,
      )
      return readFitResponse(host.id, candidate.candidateId, raw)
    } catch {
      // Every failure mode collapses to "could not be asked". A host that
      // times out mid-gallery is not evidence about whether a model fits.
      return emptyFit(host.id, candidate.candidateId)
    }
  })

  return [...done, ...unanswered]
}

function emptyFit(hostId: string, candidateId: string): HostCandidateFit {
  return {
    hostId,
    candidateId,
    answered: false,
    recommendedVariant: null,
    estimated: false,
    vramFreeMB: 0,
    vramTotalMB: 0,
    variants: [],
  }
}

/**
 * Reads the generated client's response defensively. The gallery talks to
 * whatever llama-skein build the user happens to be running, so a missing or
 * reshaped field must degrade to "unknown" rather than throw and take the
 * whole fan-out down with it.
 */
function readFitResponse(hostId: string, candidateId: string, raw: unknown): HostCandidateFit {
  const body = unwrapData(raw)
  if (!body || typeof body !== "object") return emptyFit(hostId, candidateId)
  const r = body as Record<string, unknown>
  const rawVariants = Array.isArray(r["variants"]) ? (r["variants"] as unknown[]) : []
  if (rawVariants.length === 0) return emptyFit(hostId, candidateId)

  return {
    hostId,
    candidateId,
    answered: true,
    recommendedVariant: typeof r["recommended"] === "string" ? r["recommended"] : null,
    estimated: r["estimated"] === true,
    vramFreeMB: num(r["vram_free_mb"]),
    vramTotalMB: num(r["vram_total_mb"]),
    variants: rawVariants.map((entry) => {
      const v = (entry ?? {}) as Record<string, unknown>
      return {
        hostId,
        candidateId,
        variantName: typeof v["name"] === "string" ? v["name"] : "",
        known: true,
        fitLevel: typeof v["fit_level"] === "string" ? v["fit_level"] : "unknown",
        maxFitCtx: num(v["max_fit_ctx"]),
        vramRequiredMB: num(v["vram_required_mb"]),
        modelMB: num(v["model_mb"]),
        reason: typeof v["reason"] === "string" ? v["reason"] : "",
      }
    }),
  }
}

// The generated fetch client wraps success bodies in { data }, but a plain
// object is accepted too so a test double need not imitate the envelope.
function unwrapData(raw: unknown): unknown {
  if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>)["data"]
  }
  return raw
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`hypothetical fit timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * Runs `worker` over `items` with at most `limit` in flight, preserving input
 * order in the result. Workers never reject — callers handle failure inside.
 */
async function mapPool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const size = Math.max(1, Math.min(limit, items.length))
  const results = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: size }, async () => {
      for (;;) {
        const index = next++
        if (index >= items.length) return
        results[index] = await worker(items[index]!)
      }
    }),
  )
  return results
}
