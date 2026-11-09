import type { OpenCodeClient } from "@opencode/client"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import type { endSamples } from "./server"

// Keep evidence gathering out of ordinary timed blocks. The client measures end-to-end time
// on its own clock and sends the next request even if the previous one is still outstanding.
function probe(client: OpenCodeClient) {
  const start = performance.now()
  const samples = new Array<Promise<{ at: number; latency: number; error?: string }>>()
  const tick = () => {
    const at = performance.now() - start
    samples.push(
      client.server.info({ signal: AbortSignal.timeout(15_000) }).then(
        () => ({ at, latency: performance.now() - start - at }),
        (error) => ({ at, latency: performance.now() - start - at, error: String(error) }),
      ),
    )
  }
  tick()
  const timer = setInterval(tick, 250)
  return () => {
    clearInterval(timer)
    return Promise.all(samples)
  }
}

export async function idle(client: OpenCodeClient) {
  const stop = probe(client)
  await Bun.sleep(3000)
  return stop()
}

export async function diagnose<T>(
  directory: string,
  ctx: { case: string; params: Record<string, unknown>; call<A>(name: string, ...args: unknown[]): Promise<A> },
  client: OpenCodeClient,
  baseline: Awaited<ReturnType<typeof idle>>,
  run: (activity: (children: number) => void) => Promise<T>,
) {
  await mkdir(directory, { recursive: true })
  const label =
    ctx.params.parents === undefined ? ctx.case.replaceAll(" ", "-") : `${ctx.params.parents}x${ctx.params.children}`
  const file = path.resolve(directory, `${label}-${Date.now()}`)
  const profile = process.env.SERVER_BENCH_PROFILE === "1" ? `${file}.cpuprofile` : undefined
  await ctx.call("beginSamples", profile)
  const stop = probe(client)
  const start = performance.now()
  const activity: { at: number; children: number }[] = []
  const finish = () => Promise.all([stop(), ctx.call<Awaited<ReturnType<typeof endSamples>>>("endSamples")])
  const counts = await run((children) => activity.push({ at: performance.now() - start, children })).catch(
    async (error) => {
      await finish()
      throw error
    },
  )
  const [loaded, thread] = await finish()
  await Bun.write(
    `${file}.json`,
    JSON.stringify({ params: ctx.params, profile, counts, baseline, loaded, thread, activity }, null, 2),
  )
  return counts
}
