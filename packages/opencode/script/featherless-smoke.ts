#!/usr/bin/env bun
/**
 * Featherless concurrency-gate live smoke test.
 *
 * Fires N concurrent streaming completions against the real Featherless
 * API, mixing small (cost 1) and large (cost 4) models, so the total
 * demand exceeds the account's concurrency budget. Asserts:
 *   - zero 429s (gate must queue locally instead of letting them fail)
 *   - all requests complete
 *   - timeline shows staggered "headers received" for late entrants
 *
 * Run from packages/opencode:
 *   FEATHERLESS_API_KEY=... bun run script/featherless-smoke.ts
 */

import { createFeatherlessFetch } from "../src/provider/sdk/featherless"

const SMALL_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct"
const LARGE_MODEL = "deepseek-ai/DeepSeek-V4-Flash"
const N_SMALL = 4
const N_LARGE = 2

async function fetchAccountState(apiKey: string) {
  const res = await fetch("https://api.featherless.ai/account/concurrency", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`/account/concurrency ${res.status}: ${await res.text()}`)
  return (await res.json()) as { limit: number | null; used_cost: number; request_count?: number }
}

async function lookupCosts(apiKey: string, ids: string[]): Promise<Record<string, number | undefined>> {
  const res = await fetch("https://api.featherless.ai/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const data = (await res.json()) as { data: Array<{ id: string; concurrency_cost?: number }> }
  const out: Record<string, number | undefined> = {}
  for (const id of ids) {
    out[id] = data.data.find((m) => m.id === id)?.concurrency_cost
  }
  return out
}

type Stage = "submit" | "headers" | "first_chunk" | "done" | "error"
interface Event {
  t: number
  idx: number
  modelID: string
  stage: Stage
  status?: number
}

async function main() {
  const apiKey = process.env.FEATHERLESS_API_KEY
  if (!apiKey) {
    console.error("FEATHERLESS_API_KEY not set")
    process.exit(1)
  }

  console.log("Discovering account concurrency state...")
  const state = await fetchAccountState(apiKey)
  console.log(`  limit       : ${state.limit ?? "unlimited"}`)
  console.log(`  used_cost   : ${state.used_cost}`)
  console.log(`  in flight   : ${state.request_count ?? 0}`)

  if (state.limit === null) {
    console.log("\nPlan is unlimited; the gate has nothing to gate against. Exiting.")
    process.exit(0)
  }

  console.log("\nLooking up per-model concurrency_cost...")
  const costs = await lookupCosts(apiKey, [SMALL_MODEL, LARGE_MODEL])
  const smallCost = costs[SMALL_MODEL] ?? 1
  const largeCost = costs[LARGE_MODEL] ?? 4
  console.log(`  ${SMALL_MODEL}  cost=${smallCost}`)
  console.log(`  ${LARGE_MODEL}  cost=${largeCost}`)

  const totalDemand = N_SMALL * smallCost + N_LARGE * largeCost
  const headroom = state.limit - state.used_cost
  console.log(
    `\nFiring ${N_SMALL} small + ${N_LARGE} large = ${totalDemand} cost units against ${headroom} available (limit ${state.limit}).`,
  )
  if (totalDemand > headroom) {
    console.log(`→ over budget by ${totalDemand - headroom} units; gate must queue.`)
  } else {
    console.log(`→ within budget; gate should admit all immediately.`)
  }

  const throttledFetch = createFeatherlessFetch({ apiKey })

  const t0 = Date.now()
  const events: Event[] = []
  const log = (idx: number, modelID: string, stage: Stage, status?: number) => {
    events.push({ t: Date.now() - t0, idx, modelID, stage, status })
  }
  let saw429 = false

  const fire = async (modelID: string, idx: number): Promise<void> => {
    log(idx, modelID, "submit")
    const res = await throttledFetch("https://api.featherless.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelID,
        messages: [{ role: "user", content: "Reply with one word." }],
        max_tokens: 8,
        stream: true,
      }),
    })
    log(idx, modelID, "headers", res.status)
    if (!res.ok) {
      if (res.status === 429) saw429 = true
      log(idx, modelID, "error", res.status)
      try {
        await res.text()
      } catch {}
      return
    }
    const reader = res.body!.getReader()
    let firstLogged = false
    while (true) {
      const { done } = await reader.read()
      if (done) break
      if (!firstLogged) {
        log(idx, modelID, "first_chunk")
        firstLogged = true
      }
    }
    log(idx, modelID, "done")
  }

  const tasks: Promise<void>[] = []
  let idx = 0
  // Interleave so order of submission alternates between small/large
  for (let i = 0; i < Math.max(N_SMALL, N_LARGE); i++) {
    if (i < N_SMALL) tasks.push(fire(SMALL_MODEL, idx++))
    if (i < N_LARGE) tasks.push(fire(LARGE_MODEL, idx++))
  }

  await Promise.all(tasks)

  console.log("\nTimeline:")
  console.log(`${"+t (ms)".padStart(8)}  ${"#".padStart(2)}  ${"stage".padEnd(12)}  ${"http".padEnd(5)}  model`)
  console.log("-".repeat(90))
  for (const e of events) {
    const status = e.status?.toString() ?? ""
    const short =
      e.modelID === SMALL_MODEL
        ? `small (${SMALL_MODEL.split("/").pop()})`
        : `large (${LARGE_MODEL.split("/").pop()})`
    console.log(
      `+${String(e.t).padStart(6, " ")}ms  ${String(e.idx).padStart(2)}  ${e.stage.padEnd(12)}  ${status.padEnd(5)}  ${short}`,
    )
  }

  const completed = events.filter((e) => e.stage === "done").length
  const errored = events.filter((e) => e.stage === "error").length
  const total = N_SMALL + N_LARGE
  console.log(
    `\nResult: ${completed}/${total} completed, ${errored} errored, ${saw429 ? "FAIL — saw 429" : "OK — zero 429s"}`,
  )

  process.exit(saw429 || completed < total ? 1 : 0)
}

main().catch((err) => {
  console.error("unhandled error:", err)
  process.exit(1)
})
